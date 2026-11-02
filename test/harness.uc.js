// ==UserScript==
// @name         zgcb test harness
// @description  Integration harness for the Group Close Button mod. Dev only: installed by
//               test/run.sh into a throwaway profile as the temporary Sine mod "zgcb-test-harness".
// ==/UserScript==
//
// Protocol with test/run.sh (all files live in the profile dir):
//   1. set up a plain tab group, a native Zen folder and (if possible) a split view
//   2. write "zgcb-ready"  -> run.sh takes the screenshot, then touches "zgcb-go"
//   3. if pref zgcb.before is true, write {mode:"before"} and stop
//   4. otherwise run the assertions and write "zgcb-results.json" = {mode:"after", results:[...]}

(function () {
  "use strict";

  const LOG = "[zgcb-harness]";
  const BTN = ".zen-group-close-button";
  const MOD_URL =
    "chrome://sine/content/zen-group-close-button/zen-group-close-button.uc.js";

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const profilePath = name => PathUtils.join(PathUtils.profileDir, name);
  const log = (...args) => console.log(LOG, ...args);

  async function waitFor(fn, { interval = 200, timeout = 30000, what = "condition" } = {}) {
    const start = Date.now();
    for (;;) {
      let value;
      try {
        value = fn();
      } catch (e) {
        value = undefined;
      }
      if (value) {
        return value;
      }
      if (Date.now() - start > timeout) {
        throw new Error(`timed out after ${timeout} ms waiting for ${what}`);
      }
      await sleep(interval);
    }
  }

  // Bounded wait that never throws; returns whether the condition became true.
  async function softWait(fn, opts) {
    try {
      await waitFor(fn, opts);
      return true;
    } catch (e) {
      return false;
    }
  }

  // Atomic: written to .tmp then renamed, so run.sh never reads a partial file.
  const writeResults = data => {
    const path = profilePath("zgcb-results.json");
    return IOUtils.writeJSON(path, data, { tmpPath: path + ".tmp" });
  };
  const writeReady = () => IOUtils.writeUTF8(profilePath("zgcb-ready"), String(Date.now()));

  // ---- DOM helpers ----

  const labelContainerOf = group =>
    group?.querySelector(":scope > .tab-group-label-container") ?? null;
  const buttonsOf = group =>
    group ? [...group.querySelectorAll(`:scope > .tab-group-label-container > ${BTN}`)] : [];
  const buttonOf = group => buttonsOf(group)[0] ?? null;

  function eligibleHeaders() {
    return [
      ...document.querySelectorAll(
        "#tabbrowser-tabs zen-folder, #tabbrowser-tabs tab-group:not([split-view-group])"
      ),
    ].filter(el => labelContainerOf(el));
  }

  const describe = el =>
    `${el.localName}${el.label ? `("${el.label}")` : el.id ? `#${el.id}` : ""}`;

  // Every eligible header has exactly one direct close button.
  function checkOnePerHeader() {
    const headers = eligibleHeaders();
    if (!headers.length) {
      return { pass: false, detail: "no eligible group/folder headers found" };
    }
    const bad = headers
      .map(el => [el, buttonsOf(el).length])
      .filter(([, n]) => n !== 1)
      .map(([el, n]) => `${describe(el)}=${n}`);
    return {
      pass: bad.length === 0,
      detail: bad.length
        ? `wrong button count on ${bad.length}/${headers.length} headers: ${bad.join(", ")}`
        : `${headers.length} headers, 1 button each`,
    };
  }

  const intersects = (a, b, tol = 0.5) =>
    a.width > 0 &&
    a.height > 0 &&
    b.width > 0 &&
    b.height > 0 &&
    a.left < b.right - tol &&
    a.right > b.left + tol &&
    a.top < b.bottom - tol &&
    a.bottom > b.top + tol;

  function contentRect(el) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const pl = parseFloat(cs.paddingLeft) || 0;
    const pr = parseFloat(cs.paddingRight) || 0;
    const pt = parseFloat(cs.paddingTop) || 0;
    const pb = parseFloat(cs.paddingBottom) || 0;
    const left = r.left + pl;
    const right = r.right - pr;
    const top = r.top + pt;
    const bottom = r.bottom - pb;
    return { left, right, top, bottom, width: right - left, height: bottom - top };
  }

  // Parse "rgb(r, g, b)" / "rgba(r, g, b, a)" -> [r, g, b, a]; null when unparseable.
  function parseColor(c) {
    if (c === "transparent") return [0, 0, 0, 0];
    const m = /^rgba?\(([^)]+)\)$/.exec(String(c).trim());
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }
  const sameRgb = (a, b) => {
    const pa = parseColor(a);
    const pb = parseColor(b);
    return !!pa && !!pb && pa[0] === pb[0] && pa[1] === pb[1] && pa[2] === pb[2];
  };

  // First non-transparent computed background-color walking up from el (crossing shadow
  // roots), then #navigator-toolbox, then body. Returns {color, source}.
  function opaqueBackgroundOf(el) {
    const isOpaque = c => (parseColor(c)?.[3] ?? 0) > 0;
    for (let node = el; node; node = node.parentElement ?? node.getRootNode?.().host ?? null) {
      const c = getComputedStyle(node).backgroundColor;
      if (isOpaque(c)) return { color: c, source: describe(node) };
    }
    for (const sel of ["#navigator-toolbox", "body"]) {
      const node = document.querySelector(sel);
      if (!node) continue;
      const c = getComputedStyle(node).backgroundColor;
      if (isOpaque(c)) return { color: c, source: sel };
    }
    return { color: "transparent", source: "nothing opaque found" };
  }

  const fmtRect = r =>
    `[${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}]`;

  async function waitDisconnected(group, timeout = 5000) {
    return softWait(() => !group.isConnected, { interval: 100, timeout, what: "group removal" });
  }

  // ---- setup ----

  async function setup() {
    await waitFor(
      () => window.gBrowser && window.gZenWorkspaces?.promiseInitialized && window.gZenFolders,
      { what: "gBrowser, gZenWorkspaces.promiseInitialized, gZenFolders" }
    );
    await gZenWorkspaces.promiseInitialized;
    log("browser initialized");

    const sys = Services.scriptSecurityManager.getSystemPrincipal();
    const openTabs = n =>
      Array.from({ length: n }, () => gBrowser.addTab("about:blank", { triggeringPrincipal: sys }));

    const state = {
      plain: null,
      plainExpected: Services.prefs.getBoolPref("browser.tabs.groups.enabled", false),
      plainError: null,
      folder: null,
      split: "unavailable",
      notes: [],
    };

    // 1. plain tab group
    const tabs = openTabs(3);
    if (state.plainExpected) {
      try {
        state.plain =
          gBrowser.addTabGroup(tabs, {
            label: "Research",
            color: "blue",
            insertBefore: tabs[0],
          }) ?? null;
        if (!state.plain) state.plainError = "addTabGroup returned no group";
      } catch (e) {
        state.plainError = `addTabGroup failed: ${e}`;
      }
      if (state.plainError) state.notes.push(state.plainError);
    } else {
      state.notes.push("browser.tabs.groups.enabled is false");
    }

    // 2. native Zen folder
    const tabs2 = openTabs(3);
    state.folder = gZenFolders.createFolder(tabs2, { label: "Read later", renameFolder: false });

    // 3. split view (best effort; API may differ between Zen versions)
    try {
      const [tabA, tabB] = openTabs(2);
      gZenViewSplitter?.splitTabs?.([tabA, tabB]);
      if (tabA.group?.hasAttribute("split-view-group")) {
        state.split = "created";
      }
    } catch (e) {
      state.notes.push(`splitTabs failed: ${e}`);
    }

    // Wait for the mod (when it is installed and enabled) to decorate headers, so the
    // screenshot shows its final state. Bounded and non-fatal: absent mod just times out.
    if (!Services.prefs.getBoolPref("zgcb.before", false)) {
      const modReady = await softWait(() => window.zenGroupCloseButton, { timeout: 5000 });
      state.notes.push(modReady ? "mod namespace present" : "mod namespace absent after 5 s");
    }
    await sleep(1500); // let group/folder animations settle before the screenshot
    // Diagnostic dump of each header's children (visible in zen.log).
    for (const group of [state.folder, state.plain].filter(Boolean)) {
      const kids = [...(labelContainerOf(group)?.children ?? [])].map(el => {
        const cs = getComputedStyle(el);
        return `${el.localName}.${[...el.classList].join(".")}(${cs.display}/${cs.visibility})`;
      });
      log("header", describe(group), kids.join(" "));
    }
    log("setup done", JSON.stringify({ plain: !!state.plain, folder: !!state.folder, split: state.split }));
    return state;
  }

  // ---- assertions ----

  async function runAssertions({ plain, plainExpected, plainError, folder, split, notes }) {
    const results = [];
    const add = (name, pass, detail = "", extra = {}) => {
      results.push({ name, pass: !!pass, detail: String(detail), ...extra });
      log(pass ? "PASS" : "FAIL", name, detail);
    };
    const skip = (name, detail) => add(name, true, `skipped: ${detail}`, { skipped: true });
    const guard = async (name, fn) => {
      try {
        await fn();
      } catch (e) {
        add(name, false, `threw: ${e}`);
      }
    };
    const targets = [
      ["folder", folder],
      ["plain", plain],
    ].filter(([, g]) => g);

    // A missing plain group may only be skipped when tab groups are disabled by pref.
    const noPlain = (name, detail) =>
      plainExpected ? add(name, false, `${detail}: ${plainError}`) : skip(name, detail);
    add(
      "setup",
      !!folder && (!plainExpected || !!plain),
      `folder=${!!folder} plain=${plain ? "created" : plainExpected ? "FAILED" : "skipped"} split=${split}` +
        (notes.length ? `; ${notes.join("; ")}` : "")
    );
    await guard("buttons-on-eligible", async () => {
      const r = checkOnePerHeader();
      add("buttons-on-eligible", r.pass, r.detail);
    });

    await guard("no-button-on-excluded", async () => {
      const found = [
        ...document.querySelectorAll(
          `tab-group[split-view-group] ${BTN}, zen-workspace-collapsible-pins ${BTN}, [drag-image] ${BTN}`
        ),
      ];
      const splitGroups = document.querySelectorAll("tab-group[split-view-group]").length;
      const pins = document.querySelectorAll("zen-workspace-collapsible-pins").length;
      add(
        "no-button-on-excluded",
        found.length === 0,
        `${found.length} buttons in excluded elements (split groups: ${splitGroups}, collapsible pins: ${pins})`
      );
    });

    await guard("button-visible", async () => {
      const problems = [];
      const seen = [];
      for (const [key, group] of targets) {
        const bg = opaqueBackgroundOf(labelContainerOf(group));
        const btn = buttonOf(group);
        if (!btn) {
          problems.push(`${key}: no button (bg ${bg.color} from ${bg.source})`);
          continue;
        }
        const cs = getComputedStyle(btn);
        const opacity = parseFloat(cs.opacity);
        if (cs.display === "none") problems.push(`${key}: display none`);
        if (cs.visibility !== "visible") problems.push(`${key}: visibility ${cs.visibility}`);
        if (!(opacity >= 0.5 && opacity <= 0.7)) problems.push(`${key}: opacity ${cs.opacity}`);
        if (sameRgb(cs.color, bg.color)) {
          problems.push(`${key}: color ${cs.color} equals bg ${bg.color} from ${bg.source}`);
        }
        seen.push(`${key}: color ${cs.color} vs bg ${bg.color} from ${bg.source}`);
      }
      add(
        "button-visible",
        targets.length > 0 && problems.length === 0,
        problems.length ? [...problems, ...seen].join("; ") : `ok (${seen.join("; ")})`
      );
    });

    await guard("label-color", async () => {
      const probe = document.createElement("div");
      probe.style.color = "var(--toolbar-color)";
      gBrowser.tabContainer.appendChild(probe);
      const expected = getComputedStyle(probe).color;
      probe.remove();
      const problems = [];
      for (const [key, group] of targets) {
        const label = labelContainerOf(group)?.querySelector(":scope > .tab-group-label");
        if (!label) {
          problems.push(`${key}: no label`);
          continue;
        }
        const actual = getComputedStyle(label).color;
        if (actual !== expected) problems.push(`${key}: ${actual}`);
      }
      add(
        "label-color",
        targets.length > 0 && problems.length === 0,
        problems.length
          ? `expected ${expected}; got ${problems.join("; ")}`
          : `all labels ${expected}`
      );
    });

    await guard("no-overlap", async () => {
      const problems = [];
      for (const [key, group] of targets) {
        const btn = buttonOf(group);
        if (!btn) {
          problems.push(`${key}: no button`);
          continue;
        }
        const b = btn.getBoundingClientRect();
        if (!(b.width > 0 && b.height > 0)) {
          problems.push(`${key}: button has no box ${fmtRect(b)}`);
          continue;
        }
        const container = labelContainerOf(group);
        const others = [
          ["label", container.querySelector(":scope > .tab-group-label"), true],
          ["folder-icon", container.querySelector(".tab-group-folder-icon"), false],
          ["icon-container", container.querySelector(".tab-group-icon-container"), false],
        ];
        for (const [what, el, shrink] of others) {
          if (!el) continue;
          const r = shrink ? contentRect(el) : el.getBoundingClientRect();
          if (intersects(b, r)) {
            problems.push(`${key}: button ${fmtRect(b)} overlaps ${what} ${fmtRect(r)}`);
          }
        }
      }
      add(
        "no-overlap",
        targets.length > 0 && problems.length === 0,
        problems.join("; ") || "no overlaps"
      );
    });

    await guard("collapse-survives", async () => {
      folder.collapsed = true;
      await sleep(400);
      folder.collapsed = false;
      await sleep(400);
      const n = buttonsOf(folder).length;
      add("collapse-survives", n === 1, `folder has ${n} buttons after collapse/expand`);
    });

    await guard("label-click-toggles", async () => {
      const before = folder.hasAttribute("collapsed");
      folder.labelElement.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
      await sleep(400);
      const after = folder.hasAttribute("collapsed");
      folder.collapsed = before; // restore
      await sleep(400);
      add("label-click-toggles", before !== after, `collapsed ${before} -> ${after}`);
    });

    await guard("rebuild-idempotent", async () => {
      const api = window.zenGroupCloseButton;
      if (typeof api?.refreshAll !== "function") {
        add("rebuild-idempotent", false, "window.zenGroupCloseButton.refreshAll missing");
        return;
      }
      api.refreshAll();
      api.refreshAll();
      Services.scriptloader.loadSubScript(MOD_URL, window);
      // the re-run instance initializes asynchronously
      await softWait(() => window.zenGroupCloseButton && window.zenGroupCloseButton !== api, {
        timeout: 3000,
      });
      await sleep(800);
      const r = checkOnePerHeader();
      add("rebuild-idempotent", r.pass, r.detail);
    });

    await guard("atg-duplicate-hidden", async () => {
      const dup = labelContainerOf(plain)?.querySelector(".tab-close-button");
      if (!plain || !dup) {
        if (plain) skip("atg-duplicate-hidden", "no ATG close button on plain group");
        else noPlain("atg-duplicate-hidden", "no plain group");
        return;
      }
      const d1 = getComputedStyle(dup).display;
      labelContainerOf(plain).dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      await sleep(200);
      const d2 = getComputedStyle(dup).display;
      labelContainerOf(plain).dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
      add(
        "atg-duplicate-hidden",
        d1 === "none" && d2 === "none",
        `ATG .tab-close-button display before=${d1} after-mouseover=${d2}`
      );
    });

    await guard("collapsed-sidebar-hides", async () => {
      const root = document.documentElement;
      const original = root.getAttribute("zen-sidebar-expanded");
      root.removeAttribute("zen-sidebar-expanded");
      try {
        await sleep(100);
        const problems = [];
        for (const [key, group] of targets) {
          const btn = buttonOf(group);
          if (!btn) {
            problems.push(`${key}: no button`);
            continue;
          }
          const display = getComputedStyle(btn).display;
          if (display !== "none") problems.push(`${key}: display ${display}`);
        }
        add(
          "collapsed-sidebar-hides",
          targets.length > 0 && problems.length === 0,
          problems.join("; ") || `hidden (attribute was ${JSON.stringify(original)})`
        );
      } finally {
        root.setAttribute("zen-sidebar-expanded", original ?? "true");
        await sleep(200);
      }
    });

    for (const [key, group] of targets) {
      const name = `click-closes-${key}`;
      await guard(name, async () => {
        const btn = buttonOf(group);
        if (!btn) {
          add(name, false, "no button");
          return;
        }
        const before = gBrowser.tabs.length;
        btn.click();
        const gone = await waitDisconnected(group);
        await sleep(300);
        const after = gBrowser.tabs.length;
        add(
          name,
          gone && after <= before - 3,
          `group ${gone ? "removed" : "still connected"}; tabs ${before} -> ${after}`
        );
      });
    }
    if (!plain) {
      noPlain("click-closes-plain", "no plain group");
    }

    return results;
  }

  // ---- main ----

  (async () => {
    let state = null;
    try {
      state = await setup();
    } catch (err) {
      console.error(LOG, "setup failed", err);
      await writeResults({ mode: "after", error: `setup: ${err}` });
      await writeReady();
      return;
    }

    try {
      await writeReady();
      log("ready; waiting for zgcb-go");
      const goPath = profilePath("zgcb-go");
      const start = Date.now();
      while (!(await IOUtils.exists(goPath))) {
        if (Date.now() - start > 90000) {
          throw new Error("timed out after 90 s waiting for zgcb-go");
        }
        await sleep(300);
      }

      if (Services.prefs.getBoolPref("zgcb.before", false)) {
        await writeResults({ mode: "before" });
        log("before mode: done");
        return;
      }

      const results = await runAssertions(state);
      await writeResults({ mode: "after", results });
      log("results written");
    } catch (err) {
      console.error(LOG, err);
      await writeResults({ mode: "after", error: String(err) });
    }
  })();
})();
