"""
Proof that this agentic loop is NON-deterministic.

We send the EXACT SAME input (same room, same system prompt, same messages)
to the model N times and print the FIRST tool it decides to call each time.

Because the model SAMPLES its output from a probability distribution
(temperature > 0 by default), identical inputs can yield different tool
choices across runs. A deterministic / scripted solver cannot do this —
it would print the same tool every single run.

Run it:
    export ANTHROPIC_API_KEY=sk-ant-...
    cd backend
    python prove_nondeterminism.py
"""

import collections
import os

from anthropic import Anthropic

from agent import _kickoff
from skill import SYSTEM_PROMPT, TOOLS

RUNS = 8
MODEL = "claude-sonnet-5"


def first_action(client: Anthropic) -> tuple[str, dict]:
    """Ask the model for its FIRST move given the identical starting state."""
    response = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        tools=TOOLS,
        tool_choice={"type": "auto", "disable_parallel_tool_use": True},
        messages=[{"role": "user", "content": _kickoff(15)}],
        # No temperature set => the API's default sampling => stochastic output.
        # THIS is the source of non-determinism. Nothing in Python decides the tool.
    )
    tool = next((b for b in response.content if b.type == "tool_use"), None)
    return (tool.name, tool.input) if tool else ("(no tool)", {})


def main() -> None:
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise SystemExit("Set ANTHROPIC_API_KEY first.")
    client = Anthropic()

    counts = collections.Counter()
    print(f"Sending the SAME input {RUNS} times to {MODEL}...\n")
    for i in range(RUNS):
        name, args = first_action(client)
        print(f"  run {i + 1}: first tool -> {name}{args or ''}")
        counts[name] += 1

    print("\nDistribution of the first chosen tool:", dict(counts))
    if len(counts) > 1:
        print(
            "\n=> MORE THAN ONE distinct first action from identical input.\n"
            "   The loop is provably NON-deterministic: the model sampled\n"
            "   differently each run. The Python code did not decide anything."
        )
    else:
        print(
            "\n=> All runs picked the same first action this time (can happen by\n"
            "   chance, or if the puzzle has one obvious opening). Re-run, or set a\n"
            "   higher temperature, to see the variation. It is still model-driven,\n"
            "   not scripted."
        )


if __name__ == "__main__":
    main()
