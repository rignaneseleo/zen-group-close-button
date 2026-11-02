# Group Close Button — design

Sine mod for Zen Browser. Adds an always-visible close (×) control to every tab-group and folder header in the vertical sidebar, and makes group titles use the sidebar's standard text color.

## Intent

Zen power users keep dozens of tabs in groups/folders and want a group to be as disposable as a tab: one obvious click, no menu, no confirmation. Group titles should look native (same text color as the rest of the sidebar).

## Goals

- Every eligible group/folder header shows a × at the far right, always visible, dimmed at rest, full on hover.
- One click closes the group **and all its tabs** (no confirmation; Zen/Firefox "reopen closed" covers mistakes).
- Legible in light and dark, in every workspace theme.
- Never overlaps or shifts the group icon, chevron/folder icon, or label.
- Works for plain tab groups, ATG "folder look" groups, and native Zen folders.
- Survives collapse/expand, workspace switch, drag/drop, session restore, Sine hot-reload.
- Minimal footprint: feels like a missing native feature.

## Non-goals

- No confirmation dialog, no "close N tabs" warning.
- No per-mod settings UI (`preferences.json`) in v1.
- No changes to the Zen Library (Spaces) copies of groups.
- No keyboard focus/shortcut for the × (right-click menu + Cmd+W paths already exist).

## Anti-goals

- Must never close a group when the user meant to collapse it (click must not bubble to the header toggle).
- Must never show on split-view groups, the hidden per-workspace pinned-section collapser, drag-image clones, or Library copies.
- Must not depend on Advanced Tab Groups (ATG) being installed; must not fight it when it is.

## Target environment (verified 2026-11-02)

- Zen 1.24b (Firefox 159). Sine engine 2.3.4.1c.
- Elements: `tab-group` (plain group; `[split-view-group]` = Zen split view, excluded), `zen-folder` (native folder; `zen-workspace-collapsible-pins` extends it, always hidden, excluded). Both have `> .tab-group-label-container > label.tab-group-label`. Folder header is an `hbox` (flex row); plain-group header is a `vbox`.
- Close APIs: plain → `gBrowser.removeTabGroup(group)`; folder → `folder.delete()` (removes `zen-empty-tab` placeholders then `removeTabGroup`). Both close tabs (not ungroup) and push the group to session-store closed groups.
- Creation: `TabGroupCreate` bubbles to `window` for every kind. Header markup is appended once and never rebuilt (collapse only toggles `[collapsed]`).
- Header toggle: `MozTabbrowserTabGroup.on_click` collapses on any left click inside the label container → the × must `stopPropagation` + `preventDefault` on `click`, `mousedown`, `dblclick`.
- Sine: `theme.json` manifest; `scripts` map of `*.uc.js` loaded via `loadSubScriptWithOptions` into each browser window and **re-run on every rebuild**; `addUnloadListener(cb)` is injected for hot-reload; `style.chrome` CSS is `@import`ed into `sine-mods/chrome.css` as a USER sheet (needs `!important`), mod ids sorted alphabetically; GitHub-URL installs run JS only with `sine.allow-unsafe-js`.
- Text color: `--toolbar-color` (Zen aliases it to `--toolbox-textcolor`, set per workspace). Native tab close button: `--size-item-medium` (24px) box, `--tab-close-button-padding` (4px), hover `color-mix(in srgb, currentColor 10%, transparent)`, active 20%.

## Decisions (builder follows these)

1. **Own button, own class.** JS injects `<image class="zen-group-close-button close-icon" role="button" keyNav="false" tooltiptext="Close group"/>` (created with `document.createXULElement("image")`) as the **last child** of `.tab-group-label-container`. `close-icon` reuses Zen's native `chrome://browser/skin/zen-icons/close.svg`. Do not reuse `.tab-close-button` (Zen hides it globally and has double-click logic on it). *Icon call: native Zen glyph instead of the Untitled UI pack — the spec asks for "missing native feature"; the tab rows beside it use this exact glyph.*
2. **Eligibility** (`isEligible(el)`): `el.localName === "zen-folder"` or (`el.localName === "tab-group"` and no `split-view-group` attribute); not `[drag-image]`; `gBrowser.tabContainer.contains(el)`; has a direct `.tab-group-label-container`. Nothing else is decorated (this excludes `zen-workspace-collapsible-pins`, Library copies, split views).
3. **Close** (`closeGroup(group)`): folder → `group.delete()`; otherwise `gBrowser.removeTabGroup(group)`. No `skipPermitUnload`: pages with `beforeunload` may still prompt (keeps unsaved-form safety; same as ATG and Zen's own menu). Errors are caught and logged with prefix `[zen-group-close-button]`.
4. **Lifecycle:** IIFE; `window.zenGroupCloseButton?.destroy()` first (Sine re-runs the file); wait for `gBrowser` and `gZenWorkspaces.promiseInitialized` (when present); decorate all existing eligible elements; listen `TabGroupCreate` on `window`; `MutationObserver` on `gBrowser.tabContainer` (`childList`, `subtree`) as safety net, coalesced with `requestAnimationFrame`; `destroy()` removes listeners/observer and every injected button; register with `addUnloadListener` when it exists, else `window` `unload`. `supportsUnload: true` in the manifest.
5. **CSS (all rules `!important`, scoped under `#tabbrowser-tabs`):**
   - Button: `display:flex; align-items:center; justify-content:center; flex:0 0 auto; margin-inline-start:auto; width:20px; height:20px; padding:4px; box-sizing:border-box; border-radius:var(--tab-border-radius, 6px); color:var(--toolbar-color); -moz-context-properties:fill, fill-opacity; fill:currentColor; opacity:0.6; -moz-window-dragging:no-drag; transition:opacity 120ms, background-color 120ms` (transitions off under `prefers-reduced-motion`). Hover: `opacity:1; background-color:color-mix(in srgb, currentColor 10%, transparent)`; `:hover:active` 20%.
   - Header row: `:is(tab-group, zen-folder):not([split-view-group]) > .tab-group-label-container { flex-direction:row; align-items:center }` (plain groups are a `vbox`; folders already a row). Label gets `flex:1 1 auto; min-width:0`.
   - Hide the × when the sidebar is collapsed: `:root:not([zen-sidebar-expanded]) … .zen-group-close-button { display:none }`.
   - Hide ATG's own hover-only duplicate: `#tabbrowser-tabs tab-group:has(> .tab-group-label-container > .zen-group-close-button) .tab-group-label-container .tab-close-button { display:none }` (ATG's show-on-hover rule is `(0,4,1)`; the id prefix wins).
   - Title color: `#tabbrowser-tabs :is(tab-group, zen-folder):not([split-view-group]) > .tab-group-label-container > .tab-group-label { color: var(--toolbar-color) }`.
6. **Manifest** (`theme.json`): id `zen-group-close-button`, name "Group Close Button", author `rignaneseleo`, version `1.0.0`, `fork: ["zen"]`, `style: {chrome: "chrome.css"}`, `scripts: {"zen-group-close-button.uc.js": {include: ["chrome://browser/content/browser.xhtml"], loadOrder: 30}}` (after ATG's folder-look at 20), `supportsUnload: true`, `updatedAt` = release date (must be bumped per release), absolute raw-GitHub `readme`/`image` URLs under `https://github.com/rignaneseleo/zen-group-close-button`.
7. **Repo layout:** `theme.json`, `chrome.css`, `zen-group-close-button.uc.js`, `README.md`, `LICENSE` (MIT), `assets/before.png`, `assets/after.png`, `test/` (throwaway-profile integration harness, dev only), `docs/superpowers/`.
8. **Testing:** no unit framework can load chrome JS; the test is an integration run in a **throwaway profile** cloned from the live profile's `chrome/` dir (Sine + ATG), never the live profile. A harness `.uc.js` (installed as a second temporary mod) creates a plain group and a native folder, asserts the DOM/CSS contract, clicks the ×, asserts the tabs closed, and writes `zgcb-results.json` into the profile dir. `test/run.sh` builds the profile, launches a second Zen instance (`-no-remote -new-instance --profile`), captures a screenshot of the sidebar, waits for results, kills the instance, and exits non-zero on any failed assertion.

## Left to the builder

- Exact harness timing/wait loops; how to obtain window bounds for `screencapture` (System Events bounds by pid is the suggested route).
- README wording and screenshot cropping.

## Implementation notes (post-review, 2026-11-02)

The shipped `chrome.css` differs from decision 5 in these points, each driven by a review finding:

- Header-row, label-flex and title rules are prefixed with `:root[zen-sidebar-expanded]` so the collapsed sidebar's square labels stay stock.
- The title rule also sets `background-color: transparent`, `max-width: none`, `text-align: start` so stock (non-ATG) plain-group pills stay legible.
- The button has `order: 1` so ATG's hover "Convert to Folder" button never lands to its right.
- An RTL-only `margin-inline-end` keeps the × off Zen's physically positioned folder icon.
- The ATG duplicate rule uses child combinators; a `[drag-image]` rule hides the × in drag clones.
- A collapsed stock plain group loses its outlined-pill cue (keyboard focus ring kept); only affects Zen without ATG.
- JS: `event.detail > 1` guard and a `WeakSet` of groups being closed; the × is removed with one warning if Zen's `.close-icon` glyph is missing.
