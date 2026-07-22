# Escape Room — Presentation (cheat-sheet)

> Read top to bottom. **Bold** parts are what you say out loud.

---

## 1. 20-second pitch (say this)

> **A web app escape room that demonstrates an agentic loop. An autonomous Claude agent tries to escape a user-generated room using four tools — look around, investigate an item, use an item, and escape. The agent decides which tool to call on its own each turn, with no scripted order or solution. Every run it either escapes, gets stuck, or runs out of moves.**

The three things the audience cares about:
- **Data source:** a user-generated JSON that describes the room and its items (codes, keys, clues).
- **Tools:** 4 (look_around, investigate_item, use_item_on_target, escape).
- **Flow:** think → pick 1 tool → get the result → repeat, until it escapes / gets stuck / runs out of moves.

---

## 2. What an agentic loop is (the core of the talk)

Plain LLM call: `prompt → Claude → answer → END`.

Agentic loop:
```
prompt → Claude thinks → picks 1 tool → engine executes the tool
              ↑                                   │
              └──────── tool_result fed back ─────┘
        (repeats until the agent escapes / gives up / runs out of moves)
```

**Key point:** Claude picks the action, **the code never picks for it**. There is no `if room == X: do Y`. No list of steps. The engine only knows "world physics" (whether code 4829 opens the box) — **it never tells the agent what to do**.

---

## 3. Code map — where things live (if asked "show me the code")

| File | What's inside | What to point at |
|---|---|---|
| `backend/agent.py` | **The loop itself** | `while True:` — each round: call Claude → take the tool it chose → execute → feed the result back into `messages` → repeat |
| `backend/skill.py` | System prompt + the 4 tools | The agent is "blind" and must `thinking` before every action; the prompt says *how* to reason, **not** *what* to do |
| `backend/game.py` | The engine (state machine) | `execute_tool()` — pure world logic, deterministic; there is **no** puzzle solution here |
| `backend/main.py` | FastAPI | `/session` creates a room, `/run` streams the loop over SSE |
| `frontend/src/EscapeRoom.jsx` | Dashboard | A map where the agent walks + a live "execution trace" (thought → action → result) |

**One line to know:** in `agent.py`, the call to Claude uses `tool_choice={"type": "auto"}` and **no `temperature`/`seed`** → the model picks the tool itself, with stochastic sampling.

---

## 4. Questions the boss might ask + how to answer

**"Is this a real agentic loop or just a script?"**
> A real loop. In `agent.py` there's a `while True` loop: each round Claude picks one tool, the engine executes it, the result is fed back to the model, and it repeats. There is no solver in the code — not a single line decides which tool comes next.

**"How do you know it's not deterministic / pre-programmed?"**
> We set no `temperature` and no `seed`, so the API samples stochastically. The same room produces different outcomes: we ran the same puzzle (door code 4321, book says 1234) 14 times → **12 escaped, 2 got stuck**. A deterministic script can't do that.

**"Where is the logic that solves the room?"**
> There isn't any. The engine only knows whether the right code/key opens a target — that's world physics. Every decision (what to investigate, which code to try, when to stop) is made by the model.

**"What data does it use?"**
> A user-generated JSON room: a list of items, each with its code/key/clue. The only external call is to the Anthropic API; there's no database or other service.

**"What if it gets it wrong?"**
> It self-corrects. A failure just returns "Nothing happens" (no hint, like a real escape room), so the model tries something else. In the end it either escapes, honestly says "I can't solve it", or runs out of moves.

**"Why does it sometimes take extra steps?"**
> Because it's genuinely exploring, not following a script. A script would never waste moves — those "extra" moves are exactly the proof that it improvises.

**"Which model, how much does it cost?"**
> claude-sonnet-5. Roughly $0.05–0.10 per run.

---

## 5. If they push back — the one proof that kills the doubt

Same room, 14 runs, identical input:
- all 14 first try **1234** (because the book says so) — sensible,
- **0** jump straight to the correct **4321** (so the solution doesn't leak from the code),
- outcome: **12 escaped, 2 got stuck**.

In one run the agent reasoned on its own: *"1234 didn't work, maybe it's reversed → 4321"* and escaped. In another, on the same room, it never had the insight and gave up. **That is impossible for a deterministic program** — and that's the whole point.

*(Full audit: `AGENTIC_LOOP_ANALYSIS.md`. Runs: `backend/escaping-history.json`.)*
