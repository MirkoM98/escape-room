# Escape Room — Agentic Loop Exercise

## What we're building

An autonomous Claude agent trapped in a virtual escape room. Its only goal:
unlock the exit door and escape. There is no hard-coded solution — the agent
looks around on its own, investigates objects, connects clues (code → box → key
→ door), and decides which tool to call next.

Architecture (by design): **the Python backend talks to Anthropic**; React is
only a dashboard that shows, over SSE, how the agent thinks.

```
[React UI]  --create session-->  [FastAPI]  --agentic loop-->  [Claude API]
     ^                               |                              |
     |  SSE: thinking/action/result  |  execute_tool() on GameState |
     +-------------------------------+<-----------------------------+
```

---

## What an agentic loop is

```
classic LLM call:
  prompt → Claude → answer → END

agentic loop:
  prompt → Claude → <thinking> + tool_use → engine resolves the tool
                ↓
       tool_result is fed back into messages
                ↓
          Claude → "did I escape?" → NO → next tool → ...
                                    → YES (escape) → END
```

The loop stops when: the agent calls `escape()` on an unlocked door, the model
ends its own turn (`end_turn`), or a safety cap (`max_turns`) is reached.

### 5 key concepts (and where they live in the code)

1. **Planning** — the system prompt forces the agent to `<thinking>` before every tool
2. **Tool use** — 4 tools defined in `skill.py`, executed in `game.py`
3. **Reflection** — after every `tool_result` the agent evaluates what it learned
4. **Termination** — `escape()` sets `state.escaped`, and the loop stops on its own
5. **State accumulation** — the `messages` array grows across iterations in `agent.py`

---

## Tools (executed by the local engine, not the LLM)

| Tool | What it does |
|---|---|
| `look_around()` | lists the names of every visible object (does NOT reveal locked state) |
| `investigate_item(item_name)` | detailed description + clues; pulls an item out of an unlocked container into inventory |
| `use_item_on_target(item_to_use, target_object)` | enters a code / turns a key to unlock a target |
| `escape()` | succeeds only if the exit door is already unlocked |

Default puzzle: `table 1` (clue "Box Code: 4829") → `box 1` (code 4829, holds
`brass_key`) → `door` (needs `brass_key`) → `escape()`.

---

## Files

```
backend/
  skill.py       SYSTEM_PROMPT + tool JSON schemas
  game.py        GameState + tool logic (deterministic state machine)
  agent.py       the agentic loop (Anthropic SDK) — a generator that yields events
  main.py        FastAPI: /session, /run (SSE), /actions/* (each tool as an API)
frontend/
  src/EscapeRoom.jsx   the whole dashboard (editor, live state, execution trace)
```

---

## Running it

See `README.md`. In short: `export ANTHROPIC_API_KEY=...`, run uvicorn on
:8000 and `npm run dev` on :5173.

---

## Next steps / ideas

1. Persist sessions (currently in memory) if multiple users are needed
2. Add difficulty: more boxes, decoy clues, tighter move limits
3. Stream `<thinking>` token-by-token (currently per iteration)
4. Leaderboard: how many iterations the agent needed to escape
