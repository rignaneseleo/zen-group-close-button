# Group Close Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A packaged Sine mod that adds an always-visible × to every Zen tab-group / folder header (one click closes group + tabs) and gives group titles the sidebar text color.

**Architecture:** One `.uc.js` (runs in each browser window, injects a XUL `image.zen-group-close-button` into eligible headers, closes via `folder.delete()` / `gBrowser.removeTabGroup`) + one `chrome.css` (layout, colors, hover, hides ATG's duplicate) + `theme.json`. Verified by an integration harness that runs inside a throwaway Zen profile.

**Tech Stack:** Zen 1.24b (Firefox 159) chrome JS, Sine 2.3.4 mod format, CSS, bash + macOS `screencapture`/`osascript` for the harness.

**Spec:** `docs/superpowers/specs/2026-11-02-group-close-button-design.md` — read it first; every identifier below comes from it.

## Global Constraints

- Mod id `zen-group-close-button`; script file `zen-group-close-button.uc.js` at repo root; stylesheet `chrome.css`; manifest `theme.json`.
- Button element: `image.zen-group-close-button.close-icon[role=button][keyNav=false][tooltiptext="Close group"]`, last child of `.tab-group-label-container`.
- Eligible: `zen-folder`, or `tab-group` without `split-view-group`; never `[drag-image]`; must be inside `gBrowser.tabContainer`.
- Never touch the live profile `~/Library/Application Support/zen/Profiles/qtvkhs1o.Default (release)`; tests clone its `chrome/` dir into a throwaway profile under the repo's `.scratch/` (git-ignored).
- All CSS rules `!important`, scoped under `#tabbrowser-tabs`.
- Console log prefix `[zen-group-close-button]`.
- Commit after each task; messages in normal prose.

## Review Focus

1. Header left-click must still collapse/expand; the × must not bubble (click, mousedown, dblclick). → Task 2 harness asserts clicking the label still toggles `[collapsed]` after decoration.
2. Session-restore swaps `tab-group` → `zen-folder`; the new folder must get a button and the old one must not leak listeners. → Task 2 harness asserts button count == eligible header count after creating a folder from grouped tabs.
3. Sine rebuild re-runs the script: no duplicate buttons, no duplicate listeners. → Task 2 harness calls `window.zenGroupCloseButton.refreshAll()` twice and re-executes the IIFE via `Services.scriptloader.loadSubScript`, then asserts exactly one button per header.
4. Collapsed sidebar must not show the × (label is hidden there). → Task 3 (CSS) rule + harness reads computed `display` with `:root` `zen-sidebar-expanded` removed.
5. With ATG installed, only one × per plain group (ATG's `.tab-close-button` hidden). → Task 2 harness asserts `.tab-close-button` computed `display === "none"` on hover-free and after dispatching `mouseover`.

---

### Task 1: Test harness and runner (red)

**Files:**
- Create: `test/harness.uc.js` — runs inside the test profile as a temporary Sine mod `zgcb-test-harness`.
- Create: `test/run.sh` — builds the throwaway profile, launches Zen, screenshots, collects results.
- Create: `test/README.md` — 10 lines: how to run, what it needs.
- Modify: `.gitignore` (already ignores `.scratch/`).

**Interfaces:**
- Consumes: Sine `mods.json` format (see live profile `chrome/sine-mods/mods.json` for the ATG entry shape).
- Produces: `./test/run.sh [--before] [--theme light|dark]` → exit 0 when every assertion in `<profile>/zgcb-results.json` has `pass: true`; writes `.scratch/shots/<theme>-<before|after>.png`.

- [ ] **Step 1: Write `test/harness.uc.js`**

IIFE. Waits (poll 200 ms, 30 s timeout) for `gBrowser`, `gZenWorkspaces?.promiseInitialized`, `gZenFolders`. Then:
1. `const sys = Services.scriptSecurityManager.getSystemPrincipal()`; open 3 tabs `about:blank` with `gBrowser.addTab(url, {triggeringPrincipal: sys})`; if `Services.prefs.getBoolPref("browser.tabs.groups.enabled", false)` → `plain = gBrowser.addTabGroup(tabs, {label: "Research", color: "blue", insertBefore: tabs[0]})`, else `plain = null` (record `skipped`).
2. Open 3 more tabs; `folder = gZenFolders.createFolder(tabs2, {label: "Read later", renameFolder: false})`.
3. Try split view: `gZenViewSplitter?.splitTabs?.([tabA, tabB])` inside try/catch (record `split: created|unavailable`).
4. Write marker file `PathUtils.join(PathUtils.profileDir, "zgcb-ready")`; poll for `zgcb-go` (300 ms, 90 s). If `Services.prefs.getBoolPref("zgcb.before", false)` → write results `{mode:"before"}` and stop here.
5. Assertions (each `{name, pass, detail}`):
   - `buttons-on-eligible`: every `#tabbrowser-tabs zen-folder, #tabbrowser-tabs tab-group:not([split-view-group])` whose direct `.tab-group-label-container` exists has exactly one `:scope > .tab-group-label-container > .zen-group-close-button`.
   - `no-button-on-excluded`: zero `.zen-group-close-button` inside `tab-group[split-view-group]`, `zen-workspace-collapsible-pins`, `[drag-image]`.
   - `button-visible`: for `folder` and `plain`: computed `display !== "none"`, `visibility === "visible"`, opacity in `[0.5, 0.7]`, computed `color` not equal to the sidebar background (`getComputedStyle(gBrowser.tabContainer).backgroundColor`).
   - `label-color`: computed `color` of `.tab-group-label` equals computed `color` of `#navigator-toolbox`'s `--toolbar-color` resolved via a probe element (`probe.style.color = "var(--toolbar-color)"` appended to `#tabbrowser-tabs`).
   - `no-overlap`: `getBoundingClientRect()` of the button does not intersect the label's text rect (`label.getBoundingClientRect()` shrunk by its padding) nor `.tab-group-folder-icon`/`.tab-group-icon-container` when present.
   - `collapse-survives`: `folder.collapsed = true; await 400 ms; folder.collapsed = false; await 400 ms` → still exactly one button.
   - `label-click-toggles`: dispatch `click` (`new MouseEvent("click", {bubbles: true, button: 0})`) on `folder.labelElement` → `[collapsed]` toggles; restore.
   - `rebuild-idempotent`: `window.zenGroupCloseButton.refreshAll()` twice, then `Services.scriptloader.loadSubScript("chrome://sine/content/zen-group-close-button/zen-group-close-button.uc.js", window)` → still one button per header.
   - `atg-duplicate-hidden` (only when `plain` and `plain.querySelector(".tab-close-button")`): computed `display === "none"` before and after dispatching `mouseover` on its label container.
   - `collapsed-sidebar-hides`: `document.documentElement.removeAttribute("zen-sidebar-expanded")` → button computed `display === "none"`; restore attribute to `"true"`.
   - `click-closes-folder`: `before = gBrowser.tabs.length`; `btn.click()`; wait until `!folder.isConnected` (max 5 s) → pass if disconnected and `gBrowser.tabs.length <= before - 3`.
   - `click-closes-plain` (when `plain`): same for the plain group.
6. `IOUtils.writeJSON(PathUtils.join(PathUtils.profileDir, "zgcb-results.json"), {mode: "after", results})`; on any uncaught error write `{mode:"after", error: String(err)}`.

- [ ] **Step 2: Write `test/run.sh`**

Bash, `set -euo pipefail`. Variables: `LIVE="$HOME/Library/Application Support/zen/Profiles/qtvkhs1o.Default (release)"`, `TP="$REPO/.scratch/profile"`, `ZEN=/Applications/Zen.app/Contents/MacOS/zen`. Flags `--before`, `--theme light|dark` (default dark).
1. `rm -rf "$TP"; mkdir -p "$TP/chrome"`; `rsync -a --exclude 'sine-mods/zen-tidy-tabs' --exclude '*.bak*' "$LIVE/chrome/" "$TP/chrome/"`.
2. Install the mod: `rsync -a --exclude '.git' --exclude '.scratch' --exclude 'test' --exclude 'docs' "$REPO/" "$TP/chrome/sine-mods/zen-group-close-button/"`; install harness: copy `test/harness.uc.js` to `sine-mods/zgcb-test-harness/harness.uc.js` and write its `theme.json`.
3. Write `sine-mods/mods.json` with three entries (ATG copied verbatim from the live `mods.json`, our mod from `theme.json` + `"enabled": <false when --before, else true>`, harness `{"id":"zgcb-test-harness","name":"Harness","scripts":{"harness.uc.js":{"include":["chrome://browser/content/browser.xhtml"],"loadOrder":90}},"enabled":true}`). Remove `sine-mods/chrome.css` (Sine regenerates it).
4. Write `user.js`: live `user.js` lines plus `sine.allow-unsafe-js=true`, `zgcb.before=<bool>`, `browser.shell.checkDefaultBrowser=false`, `browser.sessionstore.resume_from_crash=false`, `datareporting.policy.dataSubmissionPolicyBypassNotification=true`, `browser.aboutwelcome.enabled=false`, `zen.welcome-screen.seen=true`, `browser.startup.homepage_override.mstone="ignore"`, `ui.systemUsesDarkTheme=<1 dark|0 light>`, `browser.theme.toolbar-theme=<0 dark|1 light>`, `browser.theme.content-theme=<same>`.
5. Launch: `"$ZEN" -no-remote -new-instance --profile "$TP" >"$TP/zen.log" 2>&1 & PID=$!`.
6. Wait for `$TP/zgcb-ready` (max 120 s). Then screenshot: get window bounds via `osascript -e 'tell application "System Events" to get {position, size} of window 1 of (first process whose unix id is '$PID')'` → `screencapture -x -R x,y,w,h "$OUT"`; crop the left 320 px with `sips -c <h> 320 --cropOffset 0 0` into `.scratch/shots/<theme>-<mode>.png`. Then `touch "$TP/zgcb-go"`.
7. Wait for `zgcb-results.json` (max 60 s); `kill $PID`; print results as a table (`name | PASS/FAIL | detail`); exit 1 if any `pass:false` or `error` (in `--before` mode exit 0 once the screenshot exists).

- [ ] **Step 3: Run it to confirm it fails for the right reason**

Run: `chmod +x test/run.sh && ./test/run.sh`
Expected: `buttons-on-eligible FAIL` (no mod yet), `click-closes-* FAIL`, exit 1. If Zen never writes `zgcb-ready`, read `$TP/zen.log` and fix the harness/profile, not the mod.

- [ ] **Step 4: Commit**

```bash
git add test/ .gitignore
git commit -m "Add throwaway-profile integration harness for the group close button"
```

### Task 2: The mod — manifest, script, stylesheet (green)

**Files:**
- Create: `theme.json`, `zen-group-close-button.uc.js`, `chrome.css`, `LICENSE` (MIT, 2026 Leonardo Rignanese).

**Interfaces:**
- Produces: `window.zenGroupCloseButton = { refreshAll(), destroy() }`; CSS class `zen-group-close-button`.

- [ ] **Step 1: `theme.json`** — exactly the fields in spec decision 6; `createdAt`/`updatedAt` `"2026-11-02"`; `description` "One-click close (×) on tab-group and folder headers, plus native title color."; `tags` `["Zen Browser","Tab Groups","Folders","Vertical Tabs"]`.

- [ ] **Step 2: `zen-group-close-button.uc.js`** — IIFE with a `// ==UserScript==` header (`@name Group Close Button`). Functions (all module-private except the namespace):
  - `isEligible(el): boolean` — spec decision 2.
  - `decorate(group): void` — idempotent; builds the button per Global Constraints; listeners: `mousedown`/`dblclick` → `stopPropagation()+preventDefault()`; `click` → same, then `closeGroup(group)`.
  - `closeGroup(group): Promise<void>` — spec decision 3.
  - `refreshAll(): void` — rAF-coalesced; decorates every eligible element under `gBrowser.tabContainer`.
  - `start()` / `stop()` — spec decision 4 (`TabGroupCreate` on `window`, `MutationObserver` on `gBrowser.tabContainer` `{childList:true, subtree:true}`); `stop()` removes every `.zen-group-close-button` it created.
  - `window.zenGroupCloseButton = { refreshAll, destroy }`; `destroy()` = `stop()` + delete the namespace. Register `destroy` with `addUnloadListener` when `typeof addUnloadListener === "function"`, else on `window` `unload` `{once:true}`.
  - Bootstrap: if `document.readyState === "loading"` wait for `DOMContentLoaded`; then `await gZenWorkspaces?.promiseInitialized`; then `start()`.

- [ ] **Step 3: `chrome.css`** — spec decision 5, in this order: header row, label flex, button, hover/active, reduced-motion, collapsed sidebar, ATG duplicate, title color. Comment each block with one line naming the ATG/Zen rule it has to beat.

- [ ] **Step 4: Syntax check**

Run: `node --check zen-group-close-button.uc.js && python3 -c "import json;json.load(open('theme.json'))"`
Expected: no output, exit 0.

- [ ] **Step 5: Run the harness**

Run: `./test/run.sh --theme dark && ./test/run.sh --theme light`
Expected: every row PASS (or `skipped` for `click-closes-plain` when ATG is absent), exit 0 for both. On failure read `.scratch/profile/zen.log` for `[zen-group-close-button]` lines and fix the mod.

- [ ] **Step 6: Commit**

```bash
git add theme.json zen-group-close-button.uc.js chrome.css LICENSE
git commit -m "Add Group Close Button mod: close control on group/folder headers and native title color"
```

### Task 3: Screenshots and README (package)

**Files:**
- Create: `README.md`, `assets/before.png`, `assets/after.png`.

- [ ] **Step 1: Capture** `./test/run.sh --before --theme dark` → copy `.scratch/shots/dark-before.png` to `assets/before.png`; `./test/run.sh --theme dark` → `assets/after.png`. Open both with `Read` and confirm the × is visible on both the "Research" group and "Read later" folder in `after.png` and absent in `before.png`; re-crop if the sidebar is cut.

- [ ] **Step 2: `README.md`** — sections: one-line what it does; before/after images side by side (`<p align="center">` with both `<img width="320">`); "What changes" (3 bullets: ×, one-click close + undo via Cmd+Shift+T, title color); "Install" (Sine → Settings → install from GitHub URL `rignaneseleo/zen-group-close-button`; enable "Enable installing JS from unofficial sources" until the mod is in the Sine store; restart); "Works with" (Zen 1.24+, native folders, Advanced Tab Groups incl. folder look; not shown on split views or in the collapsed sidebar); "Notes" (pages with unsaved forms may still ask before closing; if you previously hand-patched `userChrome.css`/ATG for this, remove those rules); "Development" (`./test/run.sh`). Keep under 60 lines.

- [ ] **Step 3: Commit**

```bash
git add README.md assets/
git commit -m "Add README with before/after screenshots and install steps"
```
