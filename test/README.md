# Integration test

`./test/run.sh [--before] [--theme light|dark]` — exits 0 only when every assertion passes.

- Needs macOS, Zen at `/Applications/Zen.app`, `jq`, and Accessibility + Screen Recording permission for your terminal (System Events window bounds, `screencapture`).
- Builds a throwaway profile in `.scratch/profile` from the live profile's `chrome/` dir (Sine + Advanced Tab Groups, local tweaks stripped). The live profile is only read, never written.
- Installs the mod plus `test/harness.uc.js` as a temporary Sine mod, launches a second Zen instance (`-no-remote -new-instance`), and kills only that PID when done.
- The harness creates a tab group, a Zen folder and a split view, then writes `zgcb-ready`. The runner screenshots the sidebar to `.scratch/shots/<theme>-<before|after>.png` and touches `zgcb-go`.
- The harness then runs the assertions and writes `.scratch/profile/zgcb-results.json`. The runner prints them as `name | PASS/FAIL/SKIP | detail`.
- `--before` disables the mod and only takes the screenshot.
- Debugging: harness and console output go to `.scratch/profile/zen.log`.
