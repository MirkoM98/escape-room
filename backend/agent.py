"""
The agentic loop — this is the heart of the exercise.

    prompt -> Claude -> <thinking> + tool_use -> engine resolves tool
                     -> tool_result fed back -> Claude -> ... -> escape()

Claude decides every move. We only resolve the tools it asks for and hand the
results back. The loop terminates when the agent escapes, when the model stops
on its own (end_turn), or when we hit a safety cap on iterations.

There are TWO ways to reach Claude, chosen by `provider`:
  - "api"  — the Anthropic SDK (needs ANTHROPIC_API_KEY, pay-as-you-go, real
             native tool_use). This is the canonical loop.
  - "cli"  — shell out to the local `claude` CLI in headless mode. It uses your
             existing Claude Code login (no API key needed). The model returns a
             JSON decision each turn instead of a native tool_use block, but the
             loop is otherwise identical.
  - "auto" (default) — use the API if a key is present and valid; if there is no
             key, or the key is rejected (401), fall back to the CLI.

`run_agent` is a generator that yields plain dict events; main.py serializes
them to Server-Sent Events for the frontend terminal.
"""

import json
import os
import re
import shutil
import subprocess
import time

from anthropic import Anthropic, APIError, APIStatusError

# Transient server-side errors worth retrying (overloaded, rate limit, 5xx).
_RETRYABLE = {429, 500, 502, 503, 529}

# If the chosen model stays overloaded, fall back to these (in order).
_FALLBACK_MODELS = ["claude-sonnet-4-6", "claude-haiku-4-5"]

import game
from skill import SYSTEM_PROMPT, TOOLS

_THINKING_RE = re.compile(r"<thinking>(.*?)</thinking>", re.DOTALL | re.IGNORECASE)

# Tool names the engine understands (used to validate CLI decisions).
_VALID_TOOLS = {"look_around", "investigate_item", "use_item_on_target", "escape"}


def _kickoff(move_limit: int) -> str:
    return (
        "You wake up locked inside the room. Begin escaping. "
        "Remember: think first, then call exactly one tool. "
        f"You have a strict limit of {move_limit} moves (tool calls) — "
        "if you run out, you fail. Do not waste moves."
    )


def _extract_thinking(text: str) -> str:
    """Pull the <thinking>…</thinking> content, falling back to raw text."""
    matches = _THINKING_RE.findall(text or "")
    if matches:
        return "\n".join(m.strip() for m in matches)
    return (text or "").strip()


# ===========================================================================
# Dispatcher — pick the provider, with auto-fallback from API to CLI.
# ===========================================================================

def run_agent(
    state: game.GameState,
    api_key: str | None = None,
    model: str = "claude-sonnet-5",
    move_limit: int = 15,
    provider: str = "auto",
):
    key = api_key or os.environ.get("ANTHROPIC_API_KEY")
    provider = (provider or "auto").lower()

    if provider == "cli":
        yield from _run_cli(state, model, move_limit)
        return

    if provider == "api":
        if not key:
            yield {"type": "error", "text": "No Anthropic API key found. Set ANTHROPIC_API_KEY, or use the CLI provider."}
            return
        yield from _run_api(state, key, model, move_limit)
        return

    # --- auto -------------------------------------------------------------
    if not key:
        if _cli_available():
            yield {"type": "status", "text": "No API key — using the local Claude CLI."}
            yield from _run_cli(state, model, move_limit)
            return
        yield {
            "type": "error",
            "text": "No Anthropic API key and no `claude` CLI on PATH. Set ANTHROPIC_API_KEY or install Claude Code.",
        }
        return

    # We have a key: try the API, but if it's rejected BEFORE any tool ran
    # (e.g. an expired 401 key), quietly fall back to the CLI.
    started_tools = False
    auth_failed = False
    for ev in _run_api(state, key, model, move_limit):
        if ev.get("type") == "action":
            started_tools = True
        if ev.get("type") == "error" and ev.get("auth_fail") and not started_tools and _cli_available():
            auth_failed = True
            break
        yield ev

    if auth_failed:
        yield {"type": "status", "text": "API key rejected (401) — falling back to the local Claude CLI."}
        yield from _run_cli(state, model, move_limit)


# ===========================================================================
# Provider 1: the Anthropic SDK (native tool_use). The canonical loop.
# ===========================================================================

def _run_api(
    state: game.GameState,
    key: str,
    model: str = "claude-sonnet-5",
    move_limit: int = 15,
):
    client = Anthropic(api_key=key)
    messages: list[dict] = [{"role": "user", "content": _kickoff(move_limit)}]

    yield {"type": "status", "text": "running", "model": model, "move_limit": move_limit}

    moves_used = 0
    iteration = 0
    max_turns = move_limit + 5  # safety cap so a misbehaving model can't spin forever

    # THE AGENTIC LOOP. It runs until the agent itself decides to stop:
    #   - it escapes (escape() succeeds)      -> we return
    #   - it stops calling tools (end_turn)   -> we return
    #   - it runs out of moves                -> we return
    # The loop keeps going purely because Claude keeps asking for another tool.
    while True:
        iteration += 1
        if iteration > max_turns:
            break

        # Call Claude, retrying transient overload/5xx errors with backoff.
        # If the primary model stays overloaded, fall back to another model.
        models = [model] + [m for m in _FALLBACK_MODELS if m != model]
        response = None
        attempt = 0
        model_idx = 0
        max_attempts = 8
        while response is None:
            current_model = models[model_idx]
            try:
                response = client.messages.create(
                    model=current_model,
                    max_tokens=1024,
                    system=SYSTEM_PROMPT,
                    tools=TOOLS,
                    # Force exactly ONE tool per turn — no parallel tool calls, so
                    # the agent acts strictly one step at a time: think, act, see
                    # the result, then think again on the next iteration.
                    tool_choice={"type": "auto", "disable_parallel_tool_use": True},
                    messages=messages,
                )
            except APIStatusError as exc:
                if exc.status_code in _RETRYABLE and attempt < max_attempts:
                    attempt += 1
                    # After a couple of failed tries, switch to a fallback model.
                    if attempt % 2 == 0 and model_idx < len(models) - 1:
                        model_idx += 1
                        yield {"type": "status", "text": f"Anthropic {exc.status_code} overloaded — switching model to {models[model_idx]}"}
                    wait = min(0.8 * (2 ** (attempt - 1)), 8)
                    yield {"type": "status", "text": f"Anthropic {exc.status_code} overloaded — retry {attempt}/{max_attempts} on {models[model_idx]} in {wait:.0f}s"}
                    time.sleep(wait)
                    continue
                # 401/403 = bad/expired key -> flag so `auto` can fall back to CLI.
                yield {
                    "type": "error",
                    "text": f"Anthropic API error {exc.status_code}: {exc.message}",
                    "auth_fail": exc.status_code in (401, 403),
                }
                return
            except APIError as exc:
                yield {"type": "error", "text": f"Anthropic API error: {exc}"}
                return
            except Exception as exc:  # noqa: BLE001 — surface anything to the UI
                yield {"type": "error", "text": f"Unexpected error: {exc}"}
                return

        # Split the model's turn into narration (thinking) and the tool(s) it chose.
        # The system prompt asks for one tool per turn, but the model can still
        # emit several — and the API requires a tool_result for EVERY tool_use.
        narration = ""
        tool_uses = []
        for block in response.content:
            if block.type == "text":
                narration += block.text
            elif block.type == "tool_use":
                tool_uses.append(block)

        # No tool this turn -> the agent gave up / believes it cannot escape.
        if response.stop_reason != "tool_use" or not tool_uses:
            yield {
                "type": "done",
                "reason": "cant_solve",
                "text": narration.strip() or "I can't solve it: I ran out of ideas and stopped.",
                "state": state.snapshot(),
            }
            return

        # Resolve every tool the model requested and return one tool_result each.
        tool_results = []
        escaped_now = False
        out_of_moves = False
        last_result = ""
        for tool_use in tool_uses:
            moves_used += 1
            # The reasoning rides along in a required `thinking` field — pull it
            # out and show it, and strip it from the args we display/execute.
            raw_input = dict(tool_use.input or {})
            thinking = raw_input.pop("thinking", None) or _extract_thinking(narration)
            if thinking:
                yield {"type": "thinking", "iteration": iteration, "text": thinking}
            yield {
                "type": "action",
                "iteration": iteration,
                "move": moves_used,
                "move_limit": move_limit,
                "tool": tool_use.name,
                "input": raw_input,
            }
            result_text, update = game.execute_tool(state, tool_use.name, raw_input)
            last_result = result_text
            yield {
                "type": "result",
                "iteration": iteration,
                "move": moves_used,
                "move_limit": move_limit,
                "tool": tool_use.name,
                "text": result_text,
                "update": update,
                "state": state.snapshot(),
            }
            # The model sees the result PLUS a grounding reminder of what exists
            # and what it's carrying (the UI trace shows only result_text, clean).
            tool_results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": tool_use.id,
                    "content": f"{result_text}\n\n{state.context_footer()}",
                }
            )
            if state.escaped:
                escaped_now = True
                break
            if moves_used >= move_limit:
                out_of_moves = True
                break

        # State accumulation: the whole conversation grows so the agent remembers.
        messages.append({"role": "assistant", "content": response.content})
        messages.append({"role": "user", "content": tool_results})

        if escaped_now:
            yield {
                "type": "done",
                "reason": "escaped",
                "text": last_result,
                "state": state.snapshot(),
            }
            return

        if out_of_moves:
            yield {
                "type": "done",
                "reason": "out_of_moves",
                "text": f"OUT OF MOVES — the agent used all {move_limit} moves and did not escape.",
                "state": state.snapshot(),
            }
            return

    yield {
        "type": "done",
        "reason": "out_of_moves",
        "text": f"OUT OF MOVES — the agent used all {move_limit} moves and did not escape.",
        "state": state.snapshot(),
    }


# ===========================================================================
# Provider 2: the local `claude` CLI (no API key — uses your Claude Code login).
# ===========================================================================

# Same tools as the API, described in plain text for the CLI prompt.
_CLI_TOOLS_SPEC = (
    "TOOLS — call exactly ONE per turn:\n"
    "- look_around()                              lists the names of visible objects (not their locked state)\n"
    "- investigate_item(item_name)                read an object's description/clue, or collect an item from an unlocked container\n"
    "- use_item_on_target(item_to_use, target_object)   enter a code, or use a key you are carrying, on a target\n"
    "- escape()                                   leave the room; only works if the exit door is already unlocked\n"
    "- give_up(reason)                            ONLY if you are certain the room cannot be solved; explain why"
)

_CLI_OUTPUT_RULE = (
    "Respond with ONLY a single JSON object and NOTHING else — no prose, no markdown fences:\n"
    '{"thinking": "<what the last result told you and why you pick this action>", '
    '"tool": "<one tool name from the list>", "input": {<the tool\'s arguments, or {} if none>}}'
)


def _cli_available() -> bool:
    return shutil.which("claude") is not None


def _cli_model_arg(model: str) -> str | None:
    """Map an API model id to a CLI alias; None = let the CLI use its default."""
    m = (model or "").lower()
    if "haiku" in m:
        return "haiku"
    if "opus" in m:
        return "opus"
    if "sonnet" in m:
        return "sonnet"
    return None


def _parse_decision(text: str) -> dict | None:
    """Extract the {thinking, tool, input} JSON object from the CLI's answer."""
    if not text:
        return None
    s = text.strip()
    if s.startswith("```"):  # strip ```json … ``` fences if the model added them
        s = re.sub(r"^```[a-zA-Z]*\n?", "", s)
        s = re.sub(r"\n?```$", "", s).strip()
    obj = None
    try:
        obj = json.loads(s)
    except Exception:  # noqa: BLE001
        match = re.search(r"\{.*\}", s, re.DOTALL)
        if match:
            try:
                obj = json.loads(match.group(0))
            except Exception:  # noqa: BLE001
                obj = None
    if not isinstance(obj, dict) or "tool" not in obj:
        return None
    return obj


def _fmt_turn(thinking: str, tool: str, tool_input: dict, result: str) -> str:
    args = ", ".join(f"{k}={v!r}" for k, v in (tool_input or {}).items())
    return f"THOUGHT: {thinking}\nACTION: {tool}({args})\nRESULT: {result}\n\n"


def _build_cli_prompt(transcript: str, situation: str, move_no: int, move_limit: int) -> str:
    parts = [SYSTEM_PROMPT, "", _CLI_TOOLS_SPEC, "", _CLI_OUTPUT_RULE, ""]
    if transcript:
        parts += ["WHAT YOU HAVE DONE SO FAR:", transcript]
    parts += [
        "CURRENT SITUATION:",
        situation,
        "",
        f"This is move {move_no} of {move_limit}. Decide your next SINGLE action. Return ONLY the JSON object.",
    ]
    return "\n".join(parts)


def _cli_decide(prompt: str, model: str):
    """Run one headless `claude -p` turn; return (decision_dict_or_None, raw_text)."""
    cmd = ["claude", "-p", "--output-format", "json", "--allowed-tools", ""]
    alias = _cli_model_arg(model)
    if alias:
        cmd += ["--model", alias]
    proc = subprocess.run(cmd, input=prompt, capture_output=True, text=True, timeout=180)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or f"`claude` exited with code {proc.returncode}")
    try:
        envelope = json.loads(proc.stdout)
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"could not parse CLI output as JSON: {exc}") from exc
    if envelope.get("is_error"):
        raise RuntimeError(envelope.get("result") or "the `claude` CLI returned an error")
    inner = envelope.get("result", "")
    return _parse_decision(inner), inner


def _run_cli(state: game.GameState, model: str = "claude-sonnet-5", move_limit: int = 15):
    if not _cli_available():
        yield {"type": "error", "text": "The `claude` CLI is not on PATH. Install Claude Code, or set ANTHROPIC_API_KEY."}
        return

    yield {"type": "status", "text": "running", "model": f"cli:{model}", "move_limit": move_limit}

    transcript = ""
    situation = _kickoff(move_limit) + "\n\n" + state.context_footer()
    moves_used = 0
    iteration = 0
    max_turns = move_limit + 5

    while iteration < max_turns:
        iteration += 1
        prompt = _build_cli_prompt(transcript, situation, moves_used + 1, move_limit)
        # Each CLI turn spawns a fresh `claude -p` (~5-7s). Tell the UI we're
        # waiting so the trace/map don't look frozen during that gap.
        yield {
            "type": "status",
            "text": f"Claude (CLI) is thinking about move {moves_used + 1}…",
            "cli_wait": True,
            "iteration": iteration,
        }
        try:
            decision, raw = _cli_decide(prompt, model)
        except Exception as exc:  # noqa: BLE001
            yield {"type": "error", "text": f"Claude CLI error: {exc}"}
            return

        if decision is None:
            yield {
                "type": "done",
                "reason": "cant_solve",
                "text": (raw or "").strip() or "I can't solve it: the CLI returned no valid action.",
                "state": state.snapshot(),
            }
            return

        thinking = (decision.get("thinking") or "").strip()
        tool = (decision.get("tool") or "").strip()
        tool_input = decision.get("input") or {}
        if not isinstance(tool_input, dict):
            tool_input = {}

        if thinking:
            yield {"type": "thinking", "iteration": iteration, "text": thinking}

        # The agent decided the room is unsolvable.
        if tool == "give_up":
            reason = tool_input.get("reason") or thinking or "stuck"
            yield {
                "type": "done",
                "reason": "cant_solve",
                "text": reason if reason.lower().startswith("i can't solve") else f"I can't solve it: {reason}",
                "state": state.snapshot(),
            }
            return

        # Unknown tool -> don't spend a move; correct the model and loop again.
        if tool not in _VALID_TOOLS:
            note = f"Your last response used an unknown tool '{tool}'. Choose exactly one of: {', '.join(sorted(_VALID_TOOLS))}, or give_up."
            transcript += _fmt_turn(thinking, tool or "(none)", tool_input, note)
            situation = note + "\n\n" + state.context_footer()
            continue

        moves_used += 1
        yield {
            "type": "action",
            "iteration": iteration,
            "move": moves_used,
            "move_limit": move_limit,
            "tool": tool,
            "input": tool_input,
        }
        result_text, update = game.execute_tool(state, tool, tool_input)
        yield {
            "type": "result",
            "iteration": iteration,
            "move": moves_used,
            "move_limit": move_limit,
            "tool": tool,
            "text": result_text,
            "update": update,
            "state": state.snapshot(),
        }

        # Grow the transcript so the next stateless CLI call still "remembers".
        transcript += _fmt_turn(thinking, tool, tool_input, result_text)
        situation = result_text + "\n\n" + state.context_footer()

        if state.escaped:
            yield {"type": "done", "reason": "escaped", "text": result_text, "state": state.snapshot()}
            return
        if moves_used >= move_limit:
            yield {
                "type": "done",
                "reason": "out_of_moves",
                "text": f"OUT OF MOVES — the agent used all {move_limit} moves and did not escape.",
                "state": state.snapshot(),
            }
            return

    yield {
        "type": "done",
        "reason": "out_of_moves",
        "text": f"OUT OF MOVES — the agent used all {move_limit} moves and did not escape.",
        "state": state.snapshot(),
    }
