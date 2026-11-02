#!/usr/bin/env bash
# Integration test for the Group Close Button mod.
# Builds a throwaway Zen profile from the live profile's chrome/ dir (read-only copy),
# installs the mod + a harness mod, launches a second Zen instance, screenshots the
# sidebar, collects the harness results and exits non-zero on any failed assertion.
#
# Usage: ./test/run.sh [--before] [--theme light|dark] [--no-atg | --atg-look default|arc] [--bidi]
#   --no-atg           leave Advanced Tab Groups out of the profile (plain Zen groups + folders)
#   --atg-look LOOK    default: ATG's own look (folder-look off); arc: folder-look off + arc-style on
#   --bidi             intl.l10n.pseudo="bidi" (right-to-left UI)
# The live profile to clone chrome/ from is $ZGCB_LIVE_PROFILE (default: the author's profile).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIVE="${ZGCB_LIVE_PROFILE:-$HOME/Library/Application Support/zen/Profiles/qtvkhs1o.Default (release)}"
TP="$REPO/.scratch/profile"
SHOTS="$REPO/.scratch/shots"
ZEN=/Applications/Zen.app/Contents/MacOS/zen
MOD_ID="zen-group-close-button"
SIDEBAR_PT=320 # sidebar crop width, in points

BEFORE=false
THEME=dark
ATG_ON=true
ATG_LOOK="" # empty = whatever the profile gives (ATG's folder-look default: on)
BIDI=false
while [ $# -gt 0 ]; do
  case "$1" in
    --before) BEFORE=true ;;
    --theme)
      THEME="${2:-}"
      shift
      ;;
    --no-atg) ATG_ON=false ;;
    --atg-look)
      ATG_LOOK="${2:-}"
      shift
      ;;
    --bidi) BIDI=true ;;
    -h | --help)
      sed -n '2,11p' "$0"
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
  shift
done
case "$THEME" in
  dark) DARK_INT=1 TOOLBAR_THEME=0 ;;
  light) DARK_INT=0 TOOLBAR_THEME=1 ;;
  *)
    echo "--theme must be light or dark" >&2
    exit 2
    ;;
esac
case "$ATG_LOOK" in
  "" | default | arc) ;;
  *)
    echo "--atg-look must be default or arc" >&2
    exit 2
    ;;
esac
if ! $ATG_ON && [ -n "$ATG_LOOK" ]; then
  echo "--atg-look cannot be combined with --no-atg" >&2
  exit 2
fi
# Screenshot name suffix so variant runs do not overwrite the default ones.
VARIANT=""
$ATG_ON || VARIANT="$VARIANT-noatg"
[ -n "$ATG_LOOK" ] && VARIANT="$VARIANT-atg-$ATG_LOOK"
$BIDI && VARIANT="$VARIANT-bidi"
$BEFORE && MODE=before || MODE=after
$BEFORE && MOD_ENABLED=false || MOD_ENABLED=true

for tool in jq rsync osascript screencapture sips; do
  command -v "$tool" >/dev/null || {
    echo "missing tool: $tool" >&2
    exit 2
  }
done
[ -x "$ZEN" ] || {
  echo "Zen not found at $ZEN" >&2
  exit 2
}
[ -d "$LIVE/chrome/sine-mods" ] || {
  echo "live profile chrome/sine-mods not found: $LIVE" >&2
  exit 2
}
# Safety: the throwaway profile must live inside the repo's .scratch dir.
case "$TP" in
  "$REPO/.scratch/"*) ;;
  *)
    echo "refusing to use profile dir $TP" >&2
    exit 2
    ;;
esac

PID=""
cleanup() {
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    for _ in $(seq 1 50); do
      kill -0 "$PID" 2>/dev/null || break
      sleep 0.2
    done
    kill -9 "$PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# 1. Throwaway profile: copy Sine + mods from the live profile (read-only on the live side).
#    The live root userChrome.css holds personal tweaks (including a hand-made group close
#    button) that would contaminate both screenshots and assertions, so it is left out.
rm -rf "$TP"
mkdir -p "$TP/chrome" "$SHOTS"
RSYNC_EXCLUDES=(--exclude 'sine-mods/zen-tidy-tabs' --exclude '*.bak*' --exclude '/userChrome.css')
$ATG_ON || RSYNC_EXCLUDES+=(--exclude 'sine-mods/advanced-tab-groups')
rsync -a "${RSYNC_EXCLUDES[@]}" "$LIVE/chrome/" "$TP/chrome/"
MODS="$TP/chrome/sine-mods"
LIVE_ATG_ENTRY="null"
if $ATG_ON; then
  LIVE_ATG_ENTRY="$(jq -c '."advanced-tab-groups" // null' "$LIVE/chrome/sine-mods/mods.json")"
  if [ "$LIVE_ATG_ENTRY" = "null" ] || [ ! -d "$MODS/advanced-tab-groups" ]; then
    echo "WARNING: Advanced Tab Groups not found in the live profile; running without it" >&2
    ATG_ON=false
    LIVE_ATG_ENTRY="null"
    rm -rf "$MODS/advanced-tab-groups"
  fi
fi

# 1b. The live ATG copy carries local "LEO" patches (a hand-made close X in folder-look.uc.js and
#     a title-colour block in userChrome.css) that do what this mod does. Undo them in the copy
#     so the test exercises the mod against stock ATG. Every step is a no-op when the files are absent.
ATG="$MODS/advanced-tab-groups"
if grep -q 'leo-group-close' "$ATG/folder-look.uc.js" 2>/dev/null; then
  BAK="$LIVE/chrome/sine-mods/advanced-tab-groups/folder-look.uc.js.bak-leo2"
  if [ -f "$BAK" ] && ! grep -q 'leo-group-close' "$BAK"; then
    cp "$BAK" "$ATG/folder-look.uc.js"
  fi
fi
if [ -f "$ATG/userChrome.css" ]; then
  sed -i '' '/CUSTOM-LEO-START/,/CUSTOM-LEO-END/d' "$ATG/userChrome.css"
fi
if grep -qsE 'leo-group-close|CUSTOM-LEO|LEO:' "$ATG/folder-look.uc.js" "$ATG/userChrome.css" "$ATG/advanced-tab-groups.uc.js"; then
  echo "WARNING: ATG copy still contains LEO customizations" >&2
fi

# 2. Install the mod (repo contents) and the harness mod.
rsync -a --exclude '.git' --exclude '.gitignore' --exclude '.scratch' --exclude '.superpowers' \
  --exclude 'test' --exclude 'docs' --exclude '.DS_Store' \
  "$REPO/" "$MODS/$MOD_ID/"
HARNESS_ENTRY='{"id":"zgcb-test-harness","name":"Harness","scripts":{"harness.uc.js":{"include":["chrome://browser/content/browser.xhtml"],"loadOrder":90}},"enabled":true}'
mkdir -p "$MODS/zgcb-test-harness"
cp "$REPO/test/harness.uc.js" "$MODS/zgcb-test-harness/harness.uc.js"
echo "$HARNESS_ENTRY" | jq 'del(.enabled)' >"$MODS/zgcb-test-harness/theme.json"

# 3. mods.json: ATG verbatim from live (omitted entirely with --no-atg), the mod from its theme.json (or the spec literal
#    while theme.json does not exist yet), and the harness.
if [ -f "$REPO/theme.json" ]; then
  MOD_ENTRY="$(jq -c '.' "$REPO/theme.json")"
else
  MOD_ENTRY='{"id":"zen-group-close-button","name":"Group Close Button","author":"rignaneseleo","version":"1.0.0","fork":["zen"],"style":{"chrome":"chrome.css"},"scripts":{"zen-group-close-button.uc.js":{"include":["chrome://browser/content/browser.xhtml"],"loadOrder":30}},"supportsUnload":true}'
fi
MOD_ENTRY="$(echo "$MOD_ENTRY" | jq -c --argjson en "$MOD_ENABLED" '. + {enabled: $en}')"
# Sine loads window scripts in one loop without try/catch: a missing script file would abort
# it and the harness (loadOrder 90) would never run. Disable the entry in that case instead.
missing="$(echo "$MOD_ENTRY" | jq -r '.scripts // {} | keys[]' | while read -r f; do
  [ -f "$MODS/$MOD_ID/$f" ] || echo "$f"
done)"
if [ -n "$missing" ] && [ "$MOD_ENABLED" = true ]; then
  echo "WARNING: mod script(s) missing: $(echo "$missing" | tr '\n' ' ')- entry disabled so the harness still loads" >&2
  MOD_ENTRY="$(echo "$MOD_ENTRY" | jq -c '.enabled = false')"
fi
jq -n \
  --argjson atg "$LIVE_ATG_ENTRY" \
  --argjson mod "$MOD_ENTRY" \
  --argjson harness "$HARNESS_ENTRY" \
  '(if $atg == null then {} else {"advanced-tab-groups": $atg} end) + {($mod.id): $mod, ($harness.id): $harness}' >"$MODS/mods.json"
rm -f "$MODS/chrome.css" # Sine regenerates it from mods.json at startup

# 4. Prefs.
{
  cat "$LIVE/user.js"
  echo
  cat <<EOF
user_pref("sine.allow-unsafe-js", true);
user_pref("sine.auto-updates", false);
user_pref("sine.engine.auto-update", false);
user_pref("zgcb.before", $BEFORE);
user_pref("zgcb.atg", $ATG_ON);
user_pref("zgcb.variant", "$THEME$VARIANT");
// Zen ships with plain tab groups off (ATG force-enables them): on in every run so the plain-group path is exercised.
user_pref("browser.tabs.groups.enabled", true);
user_pref("devtools.console.stdout.chrome", true);
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.sessionstore.resume_from_crash", false);
user_pref("datareporting.policy.dataSubmissionPolicyBypassNotification", true);
user_pref("browser.aboutwelcome.enabled", false);
user_pref("zen.welcome-screen.seen", true);
user_pref("zen.updates.show-update-notification", false);
user_pref("browser.startup.homepage_override.mstone", "ignore");
user_pref("ui.systemUsesDarkTheme", $DARK_INT);
user_pref("browser.theme.toolbar-theme", $TOOLBAR_THEME);
user_pref("browser.theme.content-theme", $TOOLBAR_THEME);
EOF
  case "$ATG_LOOK" in
    default) echo 'user_pref("browser.tabs.groups.folder-look", false);' ;;
    arc)
      echo 'user_pref("browser.tabs.groups.folder-look", false);'
      echo 'user_pref("browser.tabs.groups.arc-style", true);'
      echo 'user_pref("browser.tabs.groups.show-folder-button", true);'
      ;;
  esac
  if $BIDI; then
    echo 'user_pref("intl.l10n.pseudo", "bidi");'
  fi
} >"$TP/user.js"

# 5. Launch a separate instance on the throwaway profile.
echo "launching Zen ($MODE, $THEME$VARIANT, atg=$ATG_ON) on $TP"
"$ZEN" -no-remote -new-instance --profile "$TP" >"$TP/zen.log" 2>&1 &
PID=$!
disown "$PID" 2>/dev/null || true # no "Terminated" job notice on kill
echo "pid $PID"

wait_file() { # path timeout_s
  local i
  for i in $(seq 1 $(($2 * 5))); do
    [ -e "$1" ] && return 0
    kill -0 "$PID" 2>/dev/null || {
      echo "Zen (pid $PID) exited early; see $TP/zen.log" >&2
      return 1
    }
    sleep 0.2
  done
  echo "timed out after $2 s waiting for $1; see $TP/zen.log" >&2
  return 1
}

# 6. Screenshot once the harness has built the groups.
wait_file "$TP/zgcb-ready" 120
PROC="first process whose unix id is $PID"
sysev() { osascript -e "tell application \"System Events\" to $1" 2>/dev/null; }
# System Events may not list the window yet (or briefly loses it while it moves): retry.
BOUNDS=""
for _ in $(seq 1 20); do
  # Bring the test window to the front and park it at a fixed spot on the main display
  # (new windows can open partly off-screen or on another display).
  sysev "set frontmost of ($PROC) to true" >/dev/null || true
  sysev "set position of window 1 of ($PROC) to {0, 40}" >/dev/null || true
  sysev "set size of window 1 of ($PROC) to {1280, 800}" >/dev/null || true
  sleep 1
  BOUNDS="$(sysev "get {position, size} of window 1 of ($PROC)" | tr -d ',')" || BOUNDS=""
  [ -n "$BOUNDS" ] && break
done
[ -n "$BOUNDS" ] || {
  echo "could not read the Zen window bounds via System Events" >&2
  exit 1
}
read -r X Y W H <<<"$BOUNDS"
FULL="$SHOTS/$THEME$VARIANT-$MODE-full.png"
OUT="$SHOTS/$THEME$VARIANT-$MODE.png"
# Capture the test window itself by its CGWindowID, so another window on top (for example the
# user's own Zen, which macOS may front instead because it shares the bundle id) cannot leak into
# the screenshot. Falls back to a screen-region grab when the id cannot be found.
find_window_id() {
  osascript -l JavaScript - "$PID" "$X" "$Y" "$W" "$H" 2>/dev/null <<'JS' || true
ObjC.import("CoreGraphics");
function run(argv) {
  const [pid, x, y, w0, h0] = argv.map(Number);
  const all = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionAll, 0)));
  // The browser window is the on-screen one whose bounds are closest to what System Events reported.
  const dist = b => Math.abs(b.X - x) + Math.abs(b.Y - y) + Math.abs(b.Width - w0) + Math.abs(b.Height - h0);
  const w = all
    .filter(w => w.kCGWindowOwnerPID === pid && w.kCGWindowLayer === 0 && w.kCGWindowIsOnscreen)
    .sort((a, b) => dist(a.kCGWindowBounds) - dist(b.kCGWindowBounds))
    .find(w => dist(w.kCGWindowBounds) < 80);
  if (w) return String(w.kCGWindowNumber);
  const mine = all.filter(w => w.kCGWindowOwnerPID === pid).map(w => JSON.stringify([w.kCGWindowLayer, w.kCGWindowIsOnscreen, w.kCGWindowBounds]));
  return `none ${x},${y} ${w0}x${h0}: ${mine.join(" ")}`;
}
JS
}
WIN_ID=""
for _ in 1 2 3; do # the window server list can briefly lag behind System Events
  WIN_ID="$(find_window_id)"
  case "$WIN_ID" in "" | none*) sleep 0.5 ;; *) break ;; esac
done
case "$WIN_ID" in
  none*)
    echo "window list for pid $PID: $WIN_ID" >&2
    WIN_ID=""
    ;;
esac
if [ -n "$WIN_ID" ]; then
  screencapture -x -o -l "$WIN_ID" "$FULL"
else
  echo "WARNING: no CGWindowID for pid $PID; grabbing the screen region instead" >&2
  screencapture -x -R "$X,$Y,$W,$H" "$FULL"
fi
PX_W="$(sips -g pixelWidth "$FULL" | awk '/pixelWidth/{print $2}')"
PX_H="$(sips -g pixelHeight "$FULL" | awk '/pixelHeight/{print $2}')"
CROP_W=$((SIDEBAR_PT * PX_W / W))
# sips treats offset 0 0 as "centered", so anchor at 1,1 (1 px from the top-left).
# With --bidi the sidebar is on the right edge.
CROP_X=1
$BIDI && CROP_X=$((PX_W - CROP_W - 1))
sips -c "$((PX_H - 1))" "$CROP_W" --cropOffset 1 "$CROP_X" "$FULL" --out "$OUT" >/dev/null
echo "screenshot: $OUT (window $X,$Y ${W}x$H)"
touch "$TP/zgcb-go"

# 7. Results.
RES="$TP/zgcb-results.json"
wait_file "$RES" 60 # the harness writes it atomically (tmpPath + rename)
cleanup
PID=""

if $BEFORE; then
  [ -s "$OUT" ] && exit 0
  echo "screenshot missing" >&2
  exit 1
fi

if jq -e 'has("error")' "$RES" >/dev/null; then
  echo "harness error: $(jq -r '.error' "$RES")" >&2
  exit 1
fi
jq -r '.results[] | [.name, (if .skipped then "SKIP" elif .pass then "PASS" else "FAIL" end), .detail] | join(" | ")' "$RES"
FAILS="$(jq '[.results[] | select(.pass | not)] | length' "$RES")"
TOTAL="$(jq '.results | length' "$RES")"
echo "$((TOTAL - FAILS))/$TOTAL passed"
[ "$FAILS" -eq 0 ]
