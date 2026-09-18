"""
FastAPI backend for the Escape Room agent.

Exposes:
  - The room catalogue (read-only)
  - The agentic loop as one Server-Sent Events stream

The server is stateless: a run request carries its own room, so nothing has to
survive between requests and nothing is written to disk. Everything the user
creates (their own rooms, run history) lives in the browser's localStorage.

There is no CORS middleware on purpose. In development Vite proxies /api to
this server, and in production this app serves the built frontend itself, so
every request is same-origin.

Two paths are filesystem-dependent, both read-only-safe:
  - presets-store.json is READ for rooms an earlier version saved to disk.
  - escaping-history.json is APPENDED by POST /api/history, but only when the
    filesystem is writable. That is true on a laptop and false on a serverless
    host, where the call becomes a no-op. The browser keeps its own copy of
    every run in localStorage, so the UI never depends on either file.

Set ESCAPE_ROOM_PROVIDER on a shared deployment to stop callers choosing the
provider themselves; "cli" spawns a local process and only suits a laptop.

Run it from the repository root:
    export ANTHROPIC_API_KEY=sk-ant-...
    uvicorn backend.main:app --reload --port 8000
"""

import json
import os

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from . import game, rooms
from .agent import cli_available, run_agent
from .skill import SYSTEM_PROMPT, TOOLS

MAX_MOVE_LIMIT = 40

DEFAULT_MODEL = "claude-sonnet-5"
ALLOWED_MODELS = ("claude-sonnet-5", "claude-sonnet-4-6", "claude-haiku-4-5")

FORCED_PROVIDER = os.environ.get("ESCAPE_ROOM_PROVIDER", "").strip()

_LEGACY_ROOMS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "presets-store.json")

HISTORY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "escaping-history.json")

_FRONTEND_DIST = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend", "dist"
)

app = FastAPI(title="Escape Room Agent")


class RunBody(BaseModel):
    room: dict | None = None
    model: str = DEFAULT_MODEL
    move_limit: int = 15
    provider: str = "auto"


class HistoryBody(BaseModel):
    room_name: str = "Custom room"
    outcome: str = "Ended"
    room: dict = Field(default_factory=dict)
    steps: list = Field(default_factory=list)
    state: dict | None = None


def _frame(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


def _legacy_rooms() -> list[dict]:
    try:
        with open(_LEGACY_ROOMS_FILE) as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return []
    return [{**entry, "builtin": False} for entry in data.get("custom", []) if entry.get("room")]


@app.get("/api/health")
def health() -> dict:
    return {
        "ok": True,
        "has_api_key": bool(os.environ.get("ANTHROPIC_API_KEY")),
        "has_cli": cli_available() and FORCED_PROVIDER not in ("api", "auto"),
        "tools": [t["name"] for t in TOOLS],
        "max_move_limit": MAX_MOVE_LIMIT,
        "models": list(ALLOWED_MODELS),
    }


@app.get("/api/default-room")
def default_room() -> dict:
    return {"room": rooms.DEFAULT_ROOM, "system_prompt": SYSTEM_PROMPT}


@app.get("/api/presets")
def presets() -> dict:
    catalogue = [{**p, "builtin": True} for p in rooms.PRESETS]
    return {"presets": catalogue + _legacy_rooms()}


@app.post("/api/run")
def run(body: RunBody):
    """Run the agentic loop over the supplied room, streaming one event per step."""
    state = game.GameState(body.room)
    move_limit = min(MAX_MOVE_LIMIT, max(1, body.move_limit))
    model = body.model if body.model in ALLOWED_MODELS else DEFAULT_MODEL
    provider = FORCED_PROVIDER or body.provider

    def event_stream():
        yield _frame({"type": "state", "state": state.snapshot()})
        try:
            for event in run_agent(state, model=model, move_limit=move_limit, provider=provider):
                yield _frame(event)
        except Exception as exc:  # noqa: BLE001 — a mid-stream failure must reach the UI
            yield _frame({"type": "error", "text": f"The run failed: {exc}"})
        yield "event: end\ndata: {}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _history_writable() -> bool:
    return os.access(os.path.dirname(HISTORY_FILE), os.W_OK)


def _without_llm_payloads(steps: list) -> list:
    """Drop the raw request/response dumps; they are ~3KB a step and bloat the archive."""
    return [
        {k: v for k, v in step.items() if k not in ("llmInput", "llmOutput")}
        for step in steps
        if isinstance(step, dict)
    ]


@app.post("/api/history")
def archive_run(body: HistoryBody) -> dict:
    """Append one finished run to escaping-history.json. A no-op on a read-only host."""
    if not _history_writable():
        return {"saved": False, "reason": "read-only filesystem"}
    try:
        with open(HISTORY_FILE) as f:
            runs = json.load(f).get("runs", [])
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        runs = []
    num = (runs[-1].get("num", 0) + 1) if runs else 1
    runs.append({
        "num": num,
        "room_name": body.room_name,
        "outcome": body.outcome,
        "room": body.room,
        "steps": _without_llm_payloads(body.steps),
        "state": body.state,
    })
    try:
        with open(HISTORY_FILE, "w") as f:
            json.dump({"runs": runs}, f, indent=2)
    except OSError as exc:
        return {"saved": False, "reason": str(exc)}
    return {"saved": True, "num": num}


if os.path.isdir(_FRONTEND_DIST):
    app.frontend("/", directory=_FRONTEND_DIST)
