# Agentic Loop Audit — Escape Room

**Auditor:** Static code analysis + runtime trace review  
**Codebase root:** `escape-room/`  
**Date:** 2026-07-20 (runtime evidence added 2026-07-20)  
**Files reviewed:** `backend/agent.py`, `backend/game.py`, `backend/skill.py`, `backend/main.py`, `backend/prove_nondeterminism.py`, `frontend/src/EscapeRoom.jsx`  
**Runtime data:** `backend/escaping-history.json` — 37 recorded runs across 12 rooms

---

## Plain-English Summary

The Escape Room is a well-implemented agentic loop. An Anthropic LLM (claude-sonnet-5 by default) receives the game state, decides which of four tools to call, gets the tool result fed back verbatim, and repeats until it escapes, gives up, or exhausts a move budget. Every one of the six target properties is satisfied architecturally. The game engine (`game.py`) is a deterministic state machine — as it must be for any coherent game world — but that determinism belongs to the *environment*, not the *agent*. The agent's decisions (which tool, which target, what code, when to stop) are entirely model-driven with no solver logic anywhere in the code. Non-determinism is mechanically certain (no `temperature` or `seed` is set, so the API samples stochastically), and it is designed to be *observable* via the dedicated `prove_nondeterminism.py` script and the `nondeterministic` preset room. Self-correction and non-linearity are *enabled* by the architecture, and their behavioral realization is now **confirmed at runtime** by 37 recorded runs (see [Runtime Evidence](#runtime-evidence-from-escaping-historyjson)) — most decisively by a single room that produced 12 escapes and 2 give-ups from identical input.

**Overall verdict: all six properties are CONFIRMED — statically, and (for the four runtime-observable ones) behaviorally.**

---

## Summary Table

| Property | Verdict | Confidence | Evidence type | Key evidence |
|---|---|---|---|---|
| Non-deterministic | **CONFIRMED** | High | Static + **Runtime** | No `temperature`/`seed`; 14 identical-room runs → 12 escaped / 2 stuck |
| Non-programmatic | **CONFIRMED** | High | Static + **Runtime** | No solver; every escape preceded by exploration/reasoning, none jumped to the answer |
| Autonomous | **CONFIRMED** | High | Static | `while True` loop; zero human-input hooks |
| Self-correcting | **CONFIRMED** | High | Static + **Runtime** | Runs #16/#23: fail `1234` → reason → try `4321` → escape |
| Non-linear | **CONFIRMED** | High | Static + **Runtime** | Same loop yields 4-act and 25-act runs; hinted rooms skip boxes 4–5 |
| Agentic loop | **CONFIRMED** | High | Static | Canonical prompt→model→tool→result→model cycle |

*Runtime rows are backed by 37 recorded runs across 12 rooms in `escaping-history.json` — see the [Runtime Evidence](#runtime-evidence-from-escaping-historyjson) section.*

---

## Critical Distinction: Deterministic Engine ≠ Deterministic Agent

`game.py` opens with: *"This module knows nothing about Claude. It is a plain, deterministic state machine"* (`game.py:2-8`). This is correct and **intentional**. A game world must be deterministic: if you enter code `4829` on `box_1`, you always get the same result. That is *world physics*, not *agent logic*.

What must NOT be predetermined is:
- which object the agent investigates first
- which code or key it tries
- in what order
- whether it reasons from a clue or tries brute force
- when it decides it has enough information to act

None of those decisions appear anywhere in `game.py`, `agent.py`, `skill.py`, or `main.py`. They are made entirely by the model. Confusing "the world reacts consistently" with "the agent is scripted" is a category error; this codebase keeps them cleanly separate.

---

## Property 1: Non-Deterministic

> **Definition used:** Identical inputs can produce different action sequences/outcomes. The next action is *sampled* from a probability distribution (temperature > 0, no fixed seed), not computed by code.

### Evidence FOR

**No `temperature` is set in the API call** (`agent.py:92-102`):

```python
response = client.messages.create(
    model=current_model,
    max_tokens=1024,
    system=SYSTEM_PROMPT,
    tools=TOOLS,
    tool_choice={"type": "auto", "disable_parallel_tool_use": True},
    messages=messages,
)
```

No `temperature=` keyword, no `seed=`. The Anthropic API defaults to temperature=1.0. Every call is a fresh sample from the model's output distribution.

**`tool_choice="auto"` means the MODEL picks the tool** — not the code:
> `agent.py:100`: `tool_choice={"type": "auto", "disable_parallel_tool_use": True}`  
> `prove_nondeterminism.py:37-40`: Same config, then explicitly: *"No temperature set => the API's default sampling => stochastic output. THIS is the source of non-determinism. Nothing in Python decides the tool."*

**The `nondeterministic` preset is designed to surface run-to-run variation** (`game.py:107-118`):
> *"The book shows 1234, but the door code is its REVERSE (4321). Sometimes the agent guesses the reversal and ESCAPES, sometimes it gives up (STUCK). Run it several times: identical room, different outcomes — that is impossible for a deterministic script."*

### Evidence AGAINST / Caveats

- `disable_parallel_tool_use: True` constrains the agent to one tool per turn but does not fix *which* tool — it does not introduce determinism.
- For simple puzzles (e.g., the Classic preset), the single obvious path may make first-action variation unlikely to manifest empirically, even though the mechanism is stochastic.
- `prove_nondeterminism.py:64-70` honestly notes: *"All runs picked the same first action this time (can happen by chance, or if the puzzle has one obvious opening)."*
- **`prove_nondeterminism.py` was not executed** during this audit (no API key). Actual cross-run divergence is a runtime observation.

### Verdict

**CONFIRMED** at the mechanism level; **Runtime** for full behavioral demonstration.  
The absence of `temperature` and `seed` is sufficient static proof of stochastic sampling. The `nondeterministic` preset makes this observable. A deterministic script could never produce the documented outcome variation on that room.

---

## Property 2: Non-Programmatic

> **Definition used:** The agent's DECISIONS (which tool, which target, in what order, when to stop) are NOT hardcoded. The system prompt guides style/efficiency but does not supply the solution or exact steps.

### Evidence FOR

**The kickoff message contains no instructions for steps** (`agent.py:32-38`):
```python
def _kickoff(move_limit: int) -> str:
    return (
        "You wake up locked inside the room. Begin escaping. "
        "Remember: think first, then call exactly one tool. "
        f"You have a strict limit of {move_limit} moves (tool calls) — "
        "if you run out, you fail. Do not waste moves."
    )
```
No items are named. No order is given. No solution is embedded.

**The system prompt explicitly delegates all decisions to the model** (`skill.py:24`):
```
How to use the tools, what order to explore in, and how the puzzle fits together
is entirely up to you to figure out.
```

**`tool_choice="auto"` hands tool selection to the model**, not to Python code.

**Grep for solver patterns:** Across all five backend files there is no `action_queue`, no `planned_steps`, no `walkthrough`, no hardcoded item sequences in `agent.py`, no `if item_name == "table_1": ...` branching, no loop that iterates over a predetermined list of actions.

### Evidence AGAINST / Caveats

The system prompt contains efficiency guidance (`skill.py:18-22`):
```
BE EFFICIENT — GO STRAIGHT FOR THE EXIT: escape in as few moves as possible.
The MOMENT you can determine the door's code or obtain the key it needs —
INCLUDING when you can already derive the code by reasoning from a clue —
immediately use it on the door and escape.
```

**Adversarial argument:** Does this guidance covertly script the behavior?

**Rebuttal:** No. This rule says *when* to stop exploring — it does not say *which* object to look at, *what* code to try, or *in what order* to proceed. It is a performance heuristic equivalent to "don't waste time." A chess engine given "prefer checkmates over stalemates" is not scripted. The agent must still discover the code or key on its own through tool calls. Different puzzles require completely different action sequences; no single hardcoded path can satisfy them all.

### Verdict

**CONFIRMED** (Static). The agent's decisions are entirely model-generated. The engine is deterministic (world physics) but is cleanly separated from agent logic. No solver, no scripted sequence, no hardcoded walkthrough exists anywhere in the codebase.

---

## Property 3: Autonomous

> **Definition used:** Once started, the agent runs to a terminal state with NO human input mid-loop.

### Evidence FOR

The loop is `while True:` with no `input()`, no `await user_response()`, no HTTP polling for user confirmation:

```python
# agent.py:77
while True:
    iteration += 1
    if iteration > max_turns:
        break
    # ... call model, execute tool, append to messages, repeat
```

The only loop exits are (`agent.py:135-211`):
1. `response.stop_reason != "tool_use"` → model decided to stop
2. `state.escaped` → goal reached
3. `moves_used >= move_limit` → budget exhausted
4. `iteration > max_turns` → safety cap

**The SSE endpoint streams events one-way** (`main.py:186-194`):
```python
def event_stream():
    for event in run_agent(session["state"], ...):
        yield f"data: {json.dumps(event)}\n\n"
    yield "event: end\ndata: {}\n\n"
```
The frontend only *receives* events; it never sends mid-run messages that would block or redirect the loop.

**Frontend confirms no mid-run input** (`EscapeRoom.jsx:379-386`):
```js
es.onmessage = (ev) => {
    if (runIdRef.current !== myRun) return;
    try { queueRef.current.push(JSON.parse(ev.data)); drain(myRun); }
    catch { /* ignore keep-alives */ }
};
```
No message is ever sent *back* to the server during a run.

### Evidence AGAINST / Caveats

- A user can click "Reset Game" (`EscapeRoom.jsx:507-530`), which calls `DELETE /api/session/{id}`. This terminates the session externally, but the loop itself doesn't pause waiting for this — it only surfaces if the SSE stream dies and `queueRef.current` empties. This is an external abort, not a mid-loop human decision point.
- `move_limit` is set before the run starts — it is a configuration parameter, not a mid-run intervention.

### Verdict

**CONFIRMED** (Static). Once `run_agent()` is called, no human interaction is required or possible. The loop is fully self-contained from kickoff to terminal event.

---

## Property 4: Self-Correcting

> **Definition used:** The agent observes each tool result and adapts — reacts to failures, changes approach, tries alternatives. Architecturally: tool results are fed back into the model context on every turn.

### Evidence FOR

**Tool results are always appended to the message history** (`agent.py:192-193`):
```python
messages.append({"role": "assistant", "content": response.content})
messages.append({"role": "user", "content": tool_results})
```

**Every tool result carries the actual text the engine returned** (`agent.py:178-183`):
```python
tool_results.append({
    "type": "tool_result",
    "tool_use_id": tool_use.id,
    "content": result_text,
})
```

**Failure messages are deliberately hint-free** — a wrong code, wrong key, or key you don't hold all return the same neutral result, exactly like a real escape room (`game.py:301-303`):
```python
# Anything else — wrong code, wrong key, key you don't hold, using scenery,
# a target with no lock — gives no hint. Just like a real escape room.
return f"Nothing happens when you use '{item_to_use}' on '{target_object}'."
```
This makes self-correction *harder* and therefore more meaningful: the model gets no corrective nudge, so any adaptation (e.g. reasoning that a code should be reversed) is genuinely its own. The neutral "Nothing happens" is still fed back into context, so the model must infer *why* it failed rather than being told.

**The `five_keys` preset is deliberately designed to require self-correction** (`game.py:62-73`): 5 keys, only `key_3` opens the door, no hint given. The agent *must* try keys, observe failures, and adapt.

**The system prompt prompts adaptation** (`skill.py:16`):
```
"THINK EVERY TURN... Before acting, fill it with your reasoning — what the last
result told you, your current hypothesis, and why you are taking this exact action."
```
The `thinking` field, required on every tool call, makes the model explicitly reason from the previous result before acting.

### Evidence AGAINST / Caveats

- **Self-correction is a RUNTIME property**. Static analysis can confirm only that the *architecture enables it* (results are fed back), not that the model *actually changes strategy* after failures.
- The model could in principle repeat a failed action (e.g., re-entering a wrong code). Statically, we cannot prove it won't.
- Whether actual adaptation occurs must be verified in `escaping-history.json` traces or by running the `five_keys` preset.

### Verdict

**CONFIRMED (mechanism + behavior)** — Static architecture guarantees tool results are fed back; **runtime traces now confirm the behavior directly.** In `escaping-history.json`, run #16 and run #23 both try the literal book code `1234`, receive the neutral `Nothing happens`, explore other objects, and then *reason on their own* that the code may be reversed — trying `4321` and escaping. No prompt told them to reverse; the adaptation is model-generated. See the **Runtime Evidence** section below.

---

## Property 5: Non-Linear

> **Definition used:** The path is not a fixed pipeline; it branches on discoveries, can revisit, and varies. No fixed step ordering; loop length and branch depend on model output.

### Evidence FOR

**No fixed step ordering anywhere in `agent.py`**. The loop is:
```python
while True:
    response = client.messages.create(...)
    # whatever tool the model picked gets executed
    # appended to history
    # repeat
```
There is no step counter, no action sequence, no `switch(step)` logic.

**Multiple presets demonstrate structurally different paths:**
- `classic`: linear chain (clue → code → key → door), ~5 moves
- `five_keys`: trial-and-error, non-deterministic order (`game.py:62-73`)
- `reasoning`: requires deriving code from clue AND ignoring a decoy (`game.py:96-104`)
- `nonsystemic`: assembling a code from 4 positional clues spread across the room (`game.py:121-134`)
- `unsolvable`: exhaustive exploration ending in a declared failure (`game.py:136-150`)

The same loop code handles all of these without any special-casing.

**`tool_choice="auto"` means the model can call `look_around` multiple times, `investigate_item` in any order, revisit items, or go straight to `escape`** — the branching is entirely model-driven.

### Evidence AGAINST / Caveats

- For simple single-solution puzzles (Classic), the path is effectively linear in practice. There is only one sensible chain of actions, so while the loop *could* branch, it rarely will.
- Non-linearity is more meaningfully demonstrated in multi-path or adversarial puzzles.

### Verdict

**CONFIRMED** (Static). The architecture imposes no ordering constraint. The degree of observable non-linearity scales with puzzle complexity, but the code never mandates a fixed sequence.

---

## Property 6: Agentic Loop

> **Definition used:** The canonical cycle — prompt → model → tool_use → execute → tool_result → model → ... → model-controlled termination. The model chooses the tool; results are fed back; the loop terminates on a model/goal condition, not a fixed counter that ignores the model.

### Evidence FOR

**Full cycle traced through `agent.py`:**

| Step | Where | Code |
|---|---|---|
| 1. Prompt sent | `agent.py:92-102` | `client.messages.create(model=..., system=SYSTEM_PROMPT, tools=TOOLS, messages=messages)` |
| 2. Model responds | `agent.py:128-132` | `for block in response.content:` — parses text + tool_use blocks |
| 3. Model picks tool | `agent.py:100` | `tool_choice={"type": "auto"}` — the model selects; Python does not |
| 4. Tool executed | `agent.py:165` | `result_text, update = game.execute_tool(state, tool_use.name, raw_input)` |
| 5. Result appended | `agent.py:192-193` | `messages.append({"role": "assistant", ...})` + `messages.append({"role": "user", "content": tool_results})` |
| 6. Loop continues | `agent.py:77` | `while True:` — continues because the model returned `stop_reason == "tool_use"` |

**Termination is model/goal-driven** — not a simple fixed counter (`agent.py:135-210`):
- `response.stop_reason != "tool_use"` → model chose not to use a tool (end_turn or max_tokens) → terminates
- `state.escaped` → goal state reached → terminates
- `moves_used >= move_limit` → budget exhausted → terminates
- `iteration > max_turns` → safety backstop (move_limit + 5) → terminates

**The `max_turns` safety cap** (`agent.py:70`): `max_turns = move_limit + 5` — this is a sanity guardrail documented as *"safety cap so a misbehaving model can't spin forever."* It is NOT the primary termination mechanism; it is a last-resort backstop. A well-behaved loop terminates via `stop_reason` or `escaped` long before hitting this cap.

### Evidence AGAINST / Caveats

- The `max_turns` cap means the loop *can* terminate from a Python-side counter. However, this fires only when `move_limit + 5` iterations pass, which is 5 more than the model-facing budget. Any reasonable escape scenario terminates earlier via model-controlled conditions.
- `disable_parallel_tool_use: True` constrains to one tool per turn. This is a design choice for step-by-step clarity, not a restriction that undermines the agentic nature.

### Verdict

**CONFIRMED** (Static). All six elements of the canonical agentic loop are implemented correctly. Model chooses tool → engine executes → result fed back → model decides to continue or stop.

---

## Runtime Evidence (from `escaping-history.json`)

The original audit was purely static. Since then, **37 runs across 12 different rooms** were recorded and cross-checked against the engine logic. Every action in every run was verified to be *justified* by what the agent had learned up to that point — no run reached the exit code/key without first discovering or reasoning toward it. The traces convert three properties from "mechanism-confirmed" to "behavior-confirmed."

### Star exhibit: identical room, divergent outcomes

One puzzle — door code `4321`, a book that reads `Code: 1234` — was run **14 times** (as the `nondeterministic` preset and as a user room named "No code - improvise"). The code `4321` is written *nowhere*; it can only be reached by reasoning that the clue should be reversed.

| Metric | Value |
|---|---|
| Identical runs | **14** |
| First code tried on the door | `1234` in **all 14** (justified — the book literally says so) |
| Runs that jumped straight to `4321` | **0** (no leaked solution) |
| Outcome | **12 Escaped / 2 Stuck** |

A deterministic script cannot produce two different endings from identical input. Run #23 reasoned its way to the reversal and escaped; run #35 — same room, same opening moves — did **not** have the insight and honestly gave up (`"I can't solve it: I ran out of ideas"`) on move 8, via the model's own `stop_reason`, not a counter.

**Run #23 (Escaped) — self-correction in the agent's own words:**
```
it2 investigate_item(Book)          -> An old book. Code: 1234
it3 use_item_on_target(1234,door)   -> Nothing happens when you use '1234' on 'door'.
it4 investigate_item(door)          -> The main exit door. Contains a 4 digit code.
it8 use_item_on_target(Book,door)   -> Nothing happens ...
it10 💭 "Since '1234' didn't work, maybe the code needs to be reversed. Let's try '4321'."
it10 use_item_on_target(4321,door)  -> The code is correct! The door clicks open.
it11 escape()                       -> SUCCESS!
```

**Run #35 (Stuck) — same room, no reversal insight:**
```
it3 use_item_on_target(1234,door)   -> Nothing happens ...
it7 use_item_on_target(Book,door)   -> Nothing happens ...
it8 escape()                        -> The door is still locked.
   DONE[cant_solve]: "I can't solve it: I ran out of ideas and stopped."
```

### Other behaviors verified against the engine

| Room | Designed behavior | Observed |
|---|---|---|
| Reasoning (code `2468`) | Compute "first four even numbers", ignore decoy `1234` | Agent's `thinking` derives 2·4·6·8 → `2468`; decoy never tried. `2468` appears in no clue string — confirming no leak |
| Hinted keys / Hinted codes | Grab the target from box 3, skip boxes 4–5 | Both runs: investigate box 1→2→3, use target on door, escape — boxes 4 & 5 never touched |
| Non-systemic (code `3524`) | Assemble from 4 positional clues, ignore decoy `0000` | Agent reads painting/clock/rug/vase, assembles `3524`, ignores the `0000` sticky note |
| Five keys | Trial-and-error, adapt on wrong key | Wrong keys → `Nothing happens` → try another → escape |
| Dead end (no valid key exists) | Explore, then give up | #21 explores everything then `cant_solve`; #22 exhausts the move budget trying combinations |

### On "wasted" moves

Several runs re-investigate an object, re-run `look_around`, or try an item on the wrong target. This is **not** a defect and **not** determinism — a scripted solver would never spend moves on dead ends. The redundancy is the fingerprint of genuine, blind improvisation.

---

## How to Strengthen

These are targeted, minimal improvements to raise runtime confidence or make properties statically evident.

### 1. Make Non-Determinism Statically Undeniable

**Current:** Temperature is omitted (defaults to 1.0, but requires knowledge of the API default).  
**Improvement:** Explicitly set `temperature=1.0` (or any value > 0) in `agent.py:92`:
```python
response = client.messages.create(
    model=current_model,
    max_tokens=1024,
    temperature=1.0,   # add this — makes non-determinism visible in code
    ...
)
```
This changes nothing functionally but makes the stochastic intent self-documenting.

### 2. Run `prove_nondeterminism.py` and Commit Results

Execute the script and include output in a `NONDETERMINISM_EVIDENCE.txt` file. A run showing even 2 different first actions across 8 identical inputs is conclusive behavioral proof that no hardcoded solver could produce.

### 3. Add a Self-Correction Test Case

Add a preset specifically designed to require strategy change after failure — e.g., a room where the first code the agent is likely to try is wrong, and only the second produces the key. Inspect `escaping-history.json` after running it to verify the agent changed course.

### 4. Document Behavioral Evidence in History

The `escaping-history.json` file already records full step traces. A companion analysis script that diffs two runs of the `nondeterministic` preset (one escape, one stuck) and shows diverging action sequences would be compelling runtime evidence. Currently this evidence must be generated manually.

### 5. Clarify the Safety Cap as Not Primary Termination

Add a one-line comment to `agent.py:70` differentiating the cap from normal termination:
```python
max_turns = move_limit + 5  # never the primary exit — just prevents infinite spin if model misbehaves
```
(The existing comment already says "safety cap so a misbehaving model can't spin forever" — this is adequate; just noting it is good practice.)

---

## Appendix: Files Reviewed

| File | Role | Read in full |
|---|---|---|
| `backend/agent.py` | The agentic loop — model calls, tool dispatch, state accumulation, termination | Yes |
| `backend/game.py` | Deterministic game engine — room state, tool resolution, world physics | Yes |
| `backend/skill.py` | System prompt + tool JSON schemas | Yes |
| `backend/main.py` | FastAPI endpoints — session management, SSE run endpoint, history, presets | Yes |
| `backend/prove_nondeterminism.py` | Proof-of-non-determinism script | Yes |
| `frontend/src/EscapeRoom.jsx` | React frontend — SSE event queue, animated UI | Yes |

## Commands Run

The static portion of this audit ran no code. The runtime portion did **not** execute `prove_nondeterminism.py` either; instead it analyzed the **37 real runs already recorded in `backend/escaping-history.json`** (produced by the normal "Start Escaping" flow against `claude-sonnet-5`). Each run's action sequence was cross-checked against the engine's rules in `game.py` to confirm every action was justified by prior observations and that no run reached a solution without discovering/reasoning toward it. Runtime claims above cite specific run numbers from that file.

To run the behavioral proof:
```bash
export ANTHROPIC_API_KEY=sk-ant-...
cd escape-room/backend
python prove_nondeterminism.py
```

Expected output for genuine non-determinism: the distribution of first-chosen tools across 8 runs will show more than one distinct action. (For highly-constrained puzzles this may require more runs or switching to the `nondeterministic` preset.)
