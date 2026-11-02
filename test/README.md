# Integration test

`./test/run.sh [--before] [--theme light|dark] [--no-atg | --atg-look default|arc] [--bidi]` exits 0 only when every assertion passes.

- Needs macOS, Zen at `/Applications/Zen.app`, `jq`, and Accessibility + Screen Recording permission for your terminal (System Events window bounds, `screencapture`).
- Builds a throwaway profile in `.scratch/profile` from the live profile's `chrome/` dir (Sine + Advanced Tab Groups, local tweaks stripped). The live profile is only read, never written. Point it at your own profile with `ZGCB_LIVE_PROFILE=/path/to/profile ./test/run.sh`; the default is the author's profile.
- Installs the mod plus `test/harness.uc.js` as a temporary Sine mod, launches a second Zen instance (`-no-remote -new-instance`), and kills only that PID when done.
- The harness creates a tab group, a Zen folder and a split view, then writes `zgcb-ready`. The runner screenshots the test window to `.scratch/shots/<theme>[-variant]-<before|after>.png` and touches `zgcb-go`.
- The harness then runs the assertions and writes `.scratch/profile/zgcb-results.json`. The runner prints them as `name | PASS/FAIL/SKIP | detail`. Hover checks use `InspectorUtils.addPseudoClassLock(el, ":hover")`, so they test the real `:hover` styles without moving the mouse.

Options:

- `--before` disables the mod and only takes the screenshot.
- `--theme light|dark` picks the browser theme (default `dark`).
- `--no-atg` leaves Advanced Tab Groups out of the profile and out of `mods.json`, so plain Zen tab groups (`browser.tabs.groups.enabled` is forced on) and folders are tested on their own. `atg-duplicate-hidden` is skipped.
- `--atg-look default` turns ATG's folder look off (`browser.tabs.groups.folder-look=false`). `--atg-look arc` also turns on `browser.tabs.groups.arc-style` and `browser.tabs.groups.show-folder-button`. Without the flag, ATG keeps its folder look.
- `--bidi` sets `intl.l10n.pseudo="bidi"`, which renders the browser right-to-left.

Debugging: harness and console output go to `.scratch/profile/zen.log`.
