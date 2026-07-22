# Escape Room — Agentic Loop

An autonomous Claude agent that escapes a virtual room. A Python (FastAPI)
backend runs the **agentic loop** against the Anthropic API and executes the
tools; a React + Tailwind dashboard streams the agent's thinking / actions /
results over SSE and animates the agent walking a grid in real time.

The point of the project: demonstrate a **genuine** agentic loop — the model
decides every move, there is no hard-coded solver. See `CONTEXT.md` for how it
works and `AGENTIC_LOOP_ANALYSIS.md` for a full audit with runtime evidence.

---

## Prerequisites

- Python 3.10+
- Node 18+
- **An Anthropic API key** (see below)

## The Anthropic API key (required)

The backend reads the key from the `ANTHROPIC_API_KEY` environment variable.
There is **no key input in the UI** — you must provide it to the server before
starting it. Two options:

**Option A — export it in the shell (quickest):**
```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

**Option B — a `.env` file** in `backend/` (git-ignored):
```bash
# backend/.env
ANTHROPIC_API_KEY=sk-ant-...
```
Then load it before running, e.g. `export $(grep -v '^#' .env | xargs)` (or use
your own dotenv loader).

Verify the server sees it: `curl http://localhost:8000/api/health` →
`{"ok": true, "has_api_key": true, ...}`.

---

## 1. Backend

```bash
cd backend
pip install -r requirements.txt          # anthropic, fastapi, uvicorn
export ANTHROPIC_API_KEY=sk-ant-...       # your key (see above)
uvicorn main:app --reload --port 8000
```

## 2. Frontend

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
| POST | `/api/session` | create a session from a room config |
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
