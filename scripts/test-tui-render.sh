#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./scripts/test-tui-render.sh [outside|tmux] [-- <extra pi args...>]

Modes:
  outside  Run final-frame rainbow test outside tmux
  tmux     Run tmux-focused test with animation forced on

Examples:
  ./scripts/test-tui-render.sh outside
  ./scripts/test-tui-render.sh tmux
  ./scripts/test-tui-render.sh tmux -- --model sonnet

Logs:
  render debug: /tmp/pi-rainbow-render.log
  raw ansi:     /tmp/tui-ansi.log
EOF
}

MODE="${1:-tmux}"
if [[ "${MODE}" == "-h" || "${MODE}" == "--help" ]]; then
  usage
  exit 0
fi
shift || true

if [[ "$#" -gt 0 && "$1" == "--" ]]; then
  shift
fi

case "${MODE}" in
  outside|tmux)
    ;;
  *)
    echo "Unknown mode: ${MODE}" >&2
    usage >&2
    exit 1
    ;;
esac

LOG_PATH="/tmp/pi-rainbow-render.log"
ANSI_LOG_PATH="/tmp/tui-ansi.log"
PI_BIN="${PI_BIN:-pi}"
PI_ARGS=("$@")

rm -f "${LOG_PATH}" "${ANSI_LOG_PATH}"

export PI_RAINBOW_POSTPROCESS_RAINBOW=1
export PI_RAINBOW_DEBUG_RENDER=1
export PI_TUI_WRITE_LOG="${ANSI_LOG_PATH}"

if [[ "${MODE}" == "tmux" ]]; then
  export PI_RAINBOW_FORCE_ANIMATION=1
  if [[ -z "${TMUX:-}" ]]; then
    echo "warning: tmux mode selected, but TMUX is not set" >&2
  fi
else
  unset PI_RAINBOW_FORCE_ANIMATION || true
fi

echo "mode:       ${MODE}"
echo "pi binary:  ${PI_BIN}"
echo "render log: ${LOG_PATH}"
echo "ansi log:   ${ANSI_LOG_PATH}"
echo

echo "watch for:"
echo "- postprocess: rainbow"
echo "- reduced changedLines / bytesWritten in tmux"
echo "- newer/live region still animating"
echo "- older/history rows staying visually stable"
echo

echo "tail logs in another shell:"
echo "  tail -f ${LOG_PATH}"
echo

exec "${PI_BIN}" --extension ./extensions/rainbow/index.ts "${PI_ARGS[@]}"
