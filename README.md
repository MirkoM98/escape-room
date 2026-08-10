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
cd backend && pip install -r requirements.txt && cd ..   # anthropic, fastapi, uvicorn
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

**Terminal 1 — backend**
```bash
cd backend
pip install -r requirements.txt          # anthropic, fastapi, uvicorn
export ANTHROPIC_API_KEY=sk-ant-...       # or rely on backend/.env
uvicorn main:app --reload --port 8000
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
2. Load a **preset room** (Classic, Five keys, Hinted keys/codes, Reasoning,
   Non-deterministic, Non-systemic, Dead-end), or build your own on the grid:
   click a `+` tile to add an item, click an item to edit it.
3. Hit **▶ Start Escaping** and watch:
   - the **map** — the agent (🤖) walks to objects and acts,
   - the **execution trace** — each iteration as thought → action → result,
   - the **world state** — one JSON object per item, flashing the before→after
     diff on the iteration it changes.
4. Each run ends in **Escaped 🎉**, **Out of moves ☠️**, or **Can't solve 🤷**.

Extras:
- **🔁 Loop** — keep auto-starting a new run after each one finishes.
- **✏️ Edit** a preset and **💾 Save** it (persisted on the backend); ↺ reverts.
- **🕘 History** — every run is saved and can be replayed; **🗑️ Clear** wipes it.

---

## API surface

| Method | Path | Purpose |
|---|---|---|
| GET  | `/api/health` | status + whether a key is set |
| GET  | `/api/default-room` | starter puzzle for the editor |
| GET  | `/api/presets` | preset rooms (built-in + user, with edits applied) |
| POST | `/api/presets` | create a user room |
| PUT  | `/api/presets/{id}` | save edits to a room |
| DELETE | `/api/presets/{id}` | delete a user room / revert a built-in |
| POST | `/api/session` | create a session from a room config (body accepts `provider`: `auto`/`api`/`cli`, `model`, `move_limit`) |
| GET  | `/api/session/{id}/state` | current room snapshot |
| GET  | `/api/session/{id}/run` | **SSE** — run the agentic loop |
| POST | `/api/session/{id}/actions/{tool}` | run one tool manually (look_around, investigate_item, use_item_on_target, escape) |
| GET / POST | `/api/history` | list / append run history |
| DELETE | `/api/history` | clear all history |
| GET  | `/api/history/{num}` | full record of one run (for replay) |

The action endpoints let you drive the room by hand or test tools in isolation —
the agentic loop calls the same underlying `game.py` logic.

---

## Layout

```
backend/
  skill.py       SYSTEM_PROMPT + tool JSON schemas (what the model sees)
  game.py        GameState + tool logic (deterministic world engine)
  agent.py       the agentic loop (Anthropic SDK) — yields events
  main.py        FastAPI endpoints (session, SSE run, presets, history)
  prove_nondeterminism.py   sends identical input N times to show varied choices
frontend/
  src/EscapeRoom.jsx   the whole dashboard (grid editor, map, trace, state)
CONTEXT.md               how the project works
PRESENTATION.md          a cheat-sheet for presenting it
AGENTIC_LOOP_ANALYSIS.md full audit (static + runtime evidence)
```
