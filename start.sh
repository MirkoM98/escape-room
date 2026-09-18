#!/usr/bin/env bash
#
# One command to run the whole Escape Room app.
#
#   ./start.sh
#
# Starts the FastAPI backend (:8000) and the Vite frontend (:5173) together,
# and shuts BOTH down when you press Ctrl-C. Open http://localhost:5173.
#
# The backend needs an Anthropic API key. It is read from (in order):
#   1) the ANTHROPIC_API_KEY already exported in your shell, or
#   2) a backend/.env file containing:  ANTHROPIC_API_KEY=sk-ant-...
#
# NOTE: written for macOS's built-in bash 3.2 — no bash-4+ features (no `wait -n`).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# --- Anthropic API key ------------------------------------------------------
# Pull it from backend/.env if it isn't already in the environment.
if [ -z "${ANTHROPIC_API_KEY:-}" ] && [ -f backend/.env ]; then
  line="$(grep -v '^#' backend/.env | grep ANTHROPIC_API_KEY | head -1 | xargs)"
  [ -n "$line" ] && export "$line"
fi
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "⚠️  ANTHROPIC_API_KEY is not set — the agent will error when you hit Start."
  echo "    Put it in backend/.env  (ANTHROPIC_API_KEY=sk-ant-...)  or export it."
  echo
fi

# --- first-run setup (only if something is missing) -------------------------
if [ ! -d frontend/node_modules ]; then
  echo "📦 Installing frontend deps (first run)…"
  ( cd frontend && npm install )
fi

# --- launch both, and clean up on exit --------------------------------------
BACKEND=""
FRONTEND=""
cleanup() {
  echo
  echo "🛑 Shutting down…"
  # kill each server and any child it spawned
  for pid in "$FRONTEND" "$BACKEND"; do
    [ -n "$pid" ] || continue
    pkill -P "$pid" 2>/dev/null || true
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

echo "🚪 Backend  → http://localhost:8000  (API)"
# --reload picks up backend code edits without a manual restart. It spawns a
# reloader parent + worker child; the cleanup() above reaps the child via pkill -P.
( exec python3 -m uvicorn backend.main:app --port 8000 --reload ) &
BACKEND=$!

echo "🖥️  Frontend → http://localhost:5173  (open this one)"
( cd frontend && exec node_modules/.bin/vite ) &
FRONTEND=$!

echo
echo "✅ Both running. Open http://localhost:5173 — press Ctrl-C to stop both."

# Portable wait (bash 3.2 has no `wait -n`): poll until either server exits,
# then the EXIT trap tears the other one down too.
while kill -0 "$BACKEND" 2>/dev/null && kill -0 "$FRONTEND" 2>/dev/null; do
  sleep 1
done
