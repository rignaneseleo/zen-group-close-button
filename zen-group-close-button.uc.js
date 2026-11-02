// ==UserScript==
// @name         Group Close Button
// @description  Always-visible close (×) button on Zen tab-group and folder headers.
// @author       rignaneseleo
// @version      1.0.0
// ==/UserScript==

(function () {
  "use strict";

  const LOG = "[zen-group-close-button]";
  const BTN_CLASS = "zen-group-close-button";

  // Sine re-runs every .uc.js on rebuild: tear down the previous instance first.
  try {
    window.zenGroupCloseButton?.destroy();
  } catch (e) {
    console.error(LOG, "previous instance destroy failed", e);
  }

  let started = false;
  let destroyed = false;
  let rafId = 0;
  let observer = null;
  // Groups whose close is in flight (e.g. waiting on a beforeunload prompt).
  const closing = new WeakSet();

  const labelContainerOf = el =>
    el.querySelector(":scope > .tab-group-label-container");

  // Plain tab groups (not Zen split views) and native Zen folders that live in the tab
  // strip and have a header. Excludes zen-workspace-collapsible-pins (different local
  // name), drag-image clones and Library copies (outside gBrowser.tabContainer).
  function isEligible(el) {
    if (!el || !el.isConnected) return false;
    const isFolder = el.localName === "zen-folder";
    const isPlainGroup = el.localName === "tab-group" && !el.hasAttribute("split-view-group");
    if (!isFolder && !isPlainGroup) return false;
    if (el.closest("[drag-image]")) return false;
    if (!gBrowser.tabContainer.contains(el)) return false;
    return !!labelContainerOf(el);
  }

  async function closeGroup(group) {
    if (!group?.isConnected || closing.has(group)) return;
    closing.add(group);
    try {
      if (group.localName === "zen-folder") {
        await group.delete();
      } else {
        await gBrowser.removeTabGroup(group);
      }
    } catch (e) {
      console.error(LOG, "closing group failed", e);
    } finally {
      closing.delete(group);
    }
  }

  // Keep the header's own handlers (collapse toggle, rename, drag) from seeing the event.
  function swallow(event) {
    event.stopPropagation();
    event.preventDefault();
  }

  function onButtonClick(event) {
    swallow(event);
    if (event.button !== 0) return;
    // Second click of a double-click: the next header may have slid under the pointer.
    if (event.detail > 1) return;
    // Resolve at click time: the button always sits in <group> > .tab-group-label-container.
    const group = event.currentTarget.parentElement?.parentElement;
    if (group && isEligible(group)) closeGroup(group);
  }

  function decorate(group) {
    const container = labelContainerOf(group);
    if (!container || container.querySelector(`:scope > .${BTN_CLASS}`)) return;
    const btn = document.createXULElement("image");
    btn.className = `${BTN_CLASS} close-icon`;
    btn.setAttribute("role", "button");
    btn.setAttribute("keyNav", "false");
    btn.setAttribute("tooltiptext", "Close group");
    btn.addEventListener("mousedown", swallow);
    btn.addEventListener("dblclick", swallow);
    btn.addEventListener("click", onButtonClick);
    container.appendChild(btn);
  }

  function refreshNow() {
    if (!started) return;
    // Drop buttons that ended up somewhere ineligible (e.g. a header cloned into a drag image).
    for (const btn of document.querySelectorAll(`.${BTN_CLASS}`)) {
      const container = btn.parentElement;
      const group = container?.parentElement;
      if (!container?.classList.contains("tab-group-label-container") || !isEligible(group)) {
        btn.remove();
      }
    }
    for (const el of gBrowser.tabContainer.querySelectorAll("tab-group, zen-folder")) {
      if (isEligible(el)) decorate(el);
    }
  }

  // Coalesced to one pass per frame.
  function refreshAll() {
    if (!started || rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      try {
        refreshNow();
      } catch (e) {
        console.error(LOG, "refresh failed", e);
      }
    });
  }

  function start() {
    if (started || destroyed) return;
    started = true;
    window.addEventListener("TabGroupCreate", refreshAll);
    observer = new MutationObserver(refreshAll);
    observer.observe(gBrowser.tabContainer, { childList: true, subtree: true });
    refreshNow();
  }

  function stop() {
    started = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    window.removeEventListener("TabGroupCreate", refreshAll);
    observer?.disconnect();
    observer = null;
    for (const btn of document.querySelectorAll(`.${BTN_CLASS}`)) {
      btn.remove();
    }
  }

  const api = { refreshAll, destroy };

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    stop();
    window.removeEventListener("unload", destroy);
    if (window.zenGroupCloseButton === api) delete window.zenGroupCloseButton;
  }

  window.zenGroupCloseButton = api;
  if (typeof addUnloadListener === "function") {
    addUnloadListener(destroy);
  } else {
    window.addEventListener("unload", destroy, { once: true });
  }

  (async () => {
    try {
      if (document.readyState === "loading") {
        await new Promise(resolve =>
          document.addEventListener("DOMContentLoaded", resolve, { once: true })
        );
      }
      await window.gZenWorkspaces?.promiseInitialized;
      // Bounded wait for gBrowser: poll every 100 ms for up to 10 s.
      for (let waited = 0; !window.gBrowser?.tabContainer; waited += 100) {
        if (destroyed) return;
        if (waited >= 10000) {
          console.error(LOG, "gBrowser.tabContainer not available after 10 s; not starting");
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      start();
    } catch (e) {
      console.error(LOG, "startup failed", e);
    }
  })();
})();
