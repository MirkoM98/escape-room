# Escape Room — Agentic Loop

An autonomous Claude agent that escapes a virtual room. A Python (FastAPI)
backend runs the **agentic loop** against the Anthropic API and executes the
tools; a React + Tailwind dashboard streams the agent's thinking / actions /
results over SSE and animates the agent walking a grid in real time.

The point of the project: demonstrate a **genuine** agentic loop — the model
decides every move, there is no hard-coded solver. See `CONTEXT.md` for how it
works and `AGENTIC_LOOP_ANALYSIS.md` for a full audit with runtime evidence.

---

## Quick start (one command)

```bash
git clone <this-repo-url>
cd escape-room

# 1) install deps
pip install -r requirements.txt                          # anthropic, fastapi, uvicorn
#   (the frontend's npm install runs automatically on first ./start.sh)

# 2) give the backend an Anthropic API key (see "The API key" below)
#    — OR skip this entirely and use the local `claude` CLI (see the table below)
echo 'ANTHROPIC_API_KEY=sk-ant-REPLACE_ME' > backend/.env

# 3) run everything — backend :8000 + frontend :5173, Ctrl-C stops both
./start.sh
```

Then open **http://localhost:5173** and hit **▶ Start Escaping**.

> If `./start.sh` says *permission denied*, run `chmod +x start.sh` once.
> On macOS the script is written for the built-in bash 3.2 — no extra shell needed.

## Two ways to run the agent (no API key required)

The backend can reach Claude two ways, chosen per run by `provider`:

| provider | how it reaches Claude | needs |
|---|---|---|
| `api`  | the Anthropic SDK (native tool_use) | a valid `ANTHROPIC_API_KEY` (pay-as-you-go) |
| `cli`  | the local `claude` CLI, headless (`claude -p`) | Claude Code installed & logged in — **no key** |
| `auto` (default) | API if a key works, else the CLI | either of the above |

So if your API key is missing or **expired (401)**, `auto` transparently falls
back to the local `claude` CLI and keeps going on your Claude Code login. There
is no local/offline Claude *model* — the `cli` path still calls Anthropic, it
just authenticates with your Claude Code session instead of an API key.

Check what's available: `curl http://localhost:8000/api/health` →
`{"has_api_key": true|false, "has_cli": true|false, ...}`.

## Prerequisites

- Python 3.10+
- Node 18+
- **One of:** an Anthropic API key (`api`/`auto`), **or** Claude Code installed
  and logged in (`cli`/`auto`)

## The API key (for the `api` / `auto` providers)

Skip this if you're using the `cli` provider (Claude Code login). Otherwise:

**Get one:** https://console.anthropic.com → **API Keys** → **Create Key** →
copy the `sk-ant-...` value (shown once). The account needs a little credit;
a full escape run is a handful of small calls (cents on Haiku/Sonnet).

**Give it to the backend** one of two ways — the backend reads the
`ANTHROPIC_API_KEY` environment variable:

- **Option A — a `.env` file (recommended, set once).** Put it in `backend/.env`
  (git-ignored, so it's never committed):
  ```bash
  # backend/.env  — one line, no quotes, no spaces around the =
  ANTHROPIC_API_KEY=sk-ant-...
  ```
  `./start.sh` loads this automatically.

- **Option B — export it in your shell** (takes priority over `.env`):
  ```bash
  export ANTHROPIC_API_KEY=sk-ant-...
  ./start.sh
  ```

**Verify the server sees a key:**
```bash
curl http://localhost:8000/api/health      # -> {"ok": true, "has_api_key": true, ...}
```
Note: `has_api_key: true` only means a key is *present*. If runs fail with
**401 "API key is invalid"**, the key is wrong/revoked — regenerate it.

---

## Run it manually (two terminals) — alternative to `./start.sh`

**Terminal 1 — backend** (from the repository root)
```bash
pip install -r requirements.txt          # anthropic, fastapi, uvicorn
export ANTHROPIC_API_KEY=sk-ant-...      # or rely on backend/.env
uvicorn backend.main:app --reload --port 8000
```

**Terminal 2 — frontend**
```bash
cd frontend
npm install
npm run dev                               # http://localhost:5173
```

Vite proxies `/api` → `http://localhost:8000`, so the UI and backend stay
same-origin (no CORS, SSE just works).

---

## 3. Play

1. Open http://localhost:5173.
2. Pick a **preset room** from the dropdown (Classic, Five keys, Hinted keys,
   Atomic Vault, Miracle on Ice, Summit Code, First Footstep, Reasoning,
   One-shot lock, Dead end), or build your own on the grid: click a `+` tile to
   add an item, click an item to edit it.
3. Hit **▶ Start Escaping** and watch:
   - the **map** — the agent (🤖) walks to objects and acts,
   - the **execution trace** — each iteration as thought → action → result,
   - the **world state** — one JSON object per item, flashing the before→after
     diff on the iteration it changes.
4. Each run ends in **Escaped 🎉**, **Out of moves ☠️**, or **Can't solve 🤷**.

Extras:
- **🔁 Loop** — keep auto-starting a new run after each one finishes.
- **✏️ Edit** a preset and **💾 Save** it; ↺ reverts a built-in to its original.
- **🕘 History** — every run is replayable; **🗑️ Clear** wipes it.

Rooms you create or edit, and your run history, are stored in the **browser's
localStorage**, not on the server. The server only ships the ten built-in rooms
and is otherwise stateless, which is what lets it run on a serverless host.

---

## API surface

Four endpoints, all of them read-only except the run itself. The server keeps
no per-user state and writes nothing to disk.

| Method | Path | Purpose |
|---|---|---|
| GET  | `/api/health` | status, whether a key is set, whether the `claude` CLI is available |
| GET  | `/api/default-room` | starter puzzle for the editor |
| GET  | `/api/presets` | the built-in rooms |
| POST | `/api/run` | **SSE** — run the agentic loop over the room in the request body |

`POST /api/run` takes `{room, move_limit, provider, model}` and streams one
event per step. Because the room travels with the request there is no session
to create and nothing to clean up.

---

## Deploying to Vercel

The backend is stateless and writes nothing to disk, so the whole app deploys
as a single Vercel Function that also serves the React build.

What is already wired up:

- `pyproject.toml` declares the dependencies and `[tool.vercel] entrypoint = "backend.main:app"`.
- `[tool.vercel.scripts] build` runs `build_frontend.py`, which does `npm ci && npm run build`.
- `backend/main.py` mounts `frontend/dist` with `app.frontend()` when that directory exists.
- `vercel.json` raises the function's `maxDuration` to 300s (a 40-move run is well inside that)
  and keeps the old run-history JSON out of the bundle.

Set these environment variables in the Vercel project:

| Variable | Why |
|---|---|
| `ANTHROPIC_API_KEY` | required. Server-side only — never give it a `VITE_` prefix, or it lands in the browser bundle. |
| `ESCAPE_ROOM_PROVIDER=api` | pins the provider. The `cli` provider shells out to a local `claude` binary that does not exist on Vercel, and this also stops a caller asking for it. |

**Before you make the URL public**, know that `POST /api/run` has no
authentication: anyone who has the link can spend your Anthropic credits, up to
40 model calls per request. Put Vercel's Deployment Protection (password) in
front of it, or keep the URL private. A token baked into the frontend bundle
would not help, since the browser has to send it anyway.

This configuration follows Vercel's documented zero-config FastAPI path but has
not been run against a real deployment yet.

---

## Layout

```
backend/
  skill.py       SYSTEM_PROMPT + tool JSON schemas (what the model sees)
  rooms.py       the default puzzle + the ten preset rooms (pure data)
  game.py        GameState + tool logic (deterministic world engine)
  agent.py       the agentic loop (Anthropic SDK) — yields events
  main.py        FastAPI: health, rooms, and the SSE run endpoint
  prove_nondeterminism.py   sends identical input N times to show varied choices
frontend/src/
  EscapeRoom.jsx        the dashboard composition root
  lib/grid.js           grid maths, icons, item placement
  lib/room.js           the item shape the backend expects
  lib/api.js            fetch helpers + the streaming run reader
  lib/storage.js        localStorage for your rooms and run history
  lib/trace.js          one trace entry per loop iteration
  lib/keyframes.js      the map animations
  components/           RoomMap, StepCard, StateObjectCard, ItemForm, ui
vercel.json            function duration for the deployed API
pyproject.toml         Python deps + the Vercel entrypoint
build_frontend.py      builds the React app during a Vercel deploy
CONTEXT.md               how the project works
PRESENTATION.md          a cheat-sheet for presenting it
AGENTIC_LOOP_ANALYSIS.md full audit (static + runtime evidence)
```
