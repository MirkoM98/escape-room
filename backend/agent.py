"""
The agentic loop — this is the heart of the exercise.

    prompt -> Claude -> <thinking> + tool_use -> engine resolves tool
                     -> tool_result fed back -> Claude -> ... -> escape()

Claude decides every move. We only resolve the tools it asks for and hand the
results back. The loop terminates when the agent escapes, when the model stops
on its own (end_turn), or when we hit a safety cap on iterations.

`run_agent` is a generator that yields plain dict events; main.py serializes
them to Server-Sent Events for the frontend terminal.
"""

import os
import re
import time

from anthropic import Anthropic, APIError, APIStatusError

# Transient server-side errors worth retrying (overloaded, rate limit, 5xx).
_RETRYABLE = {429, 500, 502, 503, 529}

# If the chosen model stays overloaded, fall back to these (in order).
_FALLBACK_MODELS = ["claude-sonnet-4-6", "claude-haiku-4-5"]

import game
from skill import SYSTEM_PROMPT, TOOLS

_THINKING_RE = re.compile(r"<thinking>(.*?)</thinking>", re.DOTALL | re.IGNORECASE)

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


def run_agent(
    state: game.GameState,
    api_key: str | None = None,
    model: str = "claude-sonnet-5",
    move_limit: int = 15,
):
    key = api_key or os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        yield {
            "type": "error",
            "text": "No Anthropic API key found. Export ANTHROPIC_API_KEY before starting the server.",
        }
        return

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
                yield {"type": "error", "text": f"Anthropic API error {exc.status_code}: {exc.message}"}
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
