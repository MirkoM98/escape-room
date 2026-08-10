"""
FastAPI backend for the Escape Room agent.

Exposes:
  - Session management (create a room from the frontend puzzle editor)
  - The agentic loop as a Server-Sent Events stream (/run)
  - Every tool as its own "action" API, so the room can also be driven manually
    or the tools tested in isolation.

Run it:
    export ANTHROPIC_API_KEY=sk-ant-...
    uvicorn main:app --reload --port 8000
"""

import json
import os
import uuid

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import game
from agent import run_agent, _cli_available
from skill import SYSTEM_PROMPT, TOOLS

app = FastAPI(title="Escape Room Agent")

# Local dev: the Vite frontend runs on another port. Allow it to talk to us.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory session store. Fine for a single-user local exercise.
SESSIONS: dict[str, dict] = {}

# Persistent run history, written to escaping-history.json next to this file.
HISTORY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "escaping-history.json")

# Persistent preset edits: overrides for built-in rooms + user-created rooms.
# Written to presets-store.json so edits survive restarts and are shared.
PRESETS_STORE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "presets-store.json")

_BUILTIN_IDS = {p["id"] for p in game.PRESETS}


def _load_history() -> list:
    try:
        with open(HISTORY_FILE) as f:
            return json.load(f).get("runs", [])
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def _save_history(runs: list) -> None:
    with open(HISTORY_FILE, "w") as f:
        json.dump({"runs": runs}, f, indent=2)


def _load_store() -> dict:
    try:
        with open(PRESETS_STORE_FILE) as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        data = {}
    return {"overrides": data.get("overrides", {}), "custom": data.get("custom", [])}


def _save_store(store: dict) -> None:
    with open(PRESETS_STORE_FILE, "w") as f:
        json.dump(store, f, indent=2)


def _merged_presets() -> list:
    """Built-in rooms with any saved override applied, then user-created rooms."""
    store = _load_store()
    result = []
    for p in game.PRESETS:
        room = store["overrides"].get(p["id"], p["room"])
        result.append({**p, "room": room, "custom": False, "edited": p["id"] in store["overrides"]})
    for c in store["custom"]:
        result.append({**c, "custom": True, "edited": False})
    return result


# --- request models --------------------------------------------------------

class CreateSessionBody(BaseModel):
    room: dict | None = None          # {items: [...], inventory: [...]} — optional override
    api_key: str | None = None        # optional override; server env var wins otherwise
    model: str = "claude-sonnet-5"
    move_limit: int = 15              # max tool calls before "out of moves"
    provider: str = "auto"            # "auto" | "api" | "cli" — how to reach Claude


class HistoryBody(BaseModel):
    room_name: str = "Custom room"
    outcome: str = "Ended"
    room: dict
    steps: list
    state: dict | None = None


class PresetSaveBody(BaseModel):
    name: str | None = None          # required when creating a new custom preset
    description: str | None = None
    room: dict


class InvestigateBody(BaseModel):
    item_name: str


class UseItemBody(BaseModel):
    item_to_use: str
    target_object: str


# --- helpers ---------------------------------------------------------------

def _get_session(session_id: str) -> dict:
    session = SESSIONS.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found.")
    return session


# --- meta ------------------------------------------------------------------

@app.get("/api/health")
def health() -> dict:
    return {
        "ok": True,
        "has_api_key": bool(os.environ.get("ANTHROPIC_API_KEY")),
        "has_cli": _cli_available(),
        "tools": [t["name"] for t in TOOLS],
    }


@app.get("/api/default-room")
def default_room() -> dict:
    """The starter puzzle, used to seed the frontend editor."""
    return {"room": game.DEFAULT_ROOM, "system_prompt": SYSTEM_PROMPT}


@app.get("/api/presets")
def presets() -> dict:
    """Ready-made rooms (with saved edits applied) + user-created rooms."""
    return {"presets": _merged_presets()}


@app.post("/api/presets")
def create_preset(body: PresetSaveBody) -> dict:
    """Create a new user room. Persists to presets-store.json."""
    if not (body.name and body.name.strip()):
        raise HTTPException(status_code=400, detail="A preset name is required.")
    store = _load_store()
    entry = {
        "id": f"custom_{uuid.uuid4().hex[:8]}",
        "name": body.name.strip(),
        "description": (body.description or "Your saved room").strip(),
        "room": body.room,
    }
    store["custom"].append(entry)
    _save_store(store)
    return {**entry, "custom": True, "edited": False}


@app.put("/api/presets/{preset_id}")
def save_preset(preset_id: str, body: PresetSaveBody) -> dict:
    """Save edits to a room. Built-ins become overrides; custom rooms update in place."""
    store = _load_store()
    if preset_id in _BUILTIN_IDS:
        store["overrides"][preset_id] = body.room
    else:
        entry = next((c for c in store["custom"] if c["id"] == preset_id), None)
        if entry is None:
            raise HTTPException(status_code=404, detail="Preset not found.")
        entry["room"] = body.room
        if body.name and body.name.strip():
            entry["name"] = body.name.strip()
        if body.description is not None:
            entry["description"] = body.description.strip()
    _save_store(store)
    return {"ok": True}


@app.delete("/api/presets/{preset_id}")
def delete_preset(preset_id: str) -> dict:
    """Delete a custom room, or revert a built-in room to its original."""
    store = _load_store()
    if preset_id in _BUILTIN_IDS:
        store["overrides"].pop(preset_id, None)
    else:
        store["custom"] = [c for c in store["custom"] if c["id"] != preset_id]
    _save_store(store)
    return {"ok": True}


# --- run history -----------------------------------------------------------

@app.post("/api/history")
def add_history(body: HistoryBody) -> dict:
    runs = _load_history()
    num = (runs[-1]["num"] + 1) if runs else 1
    entry = {
        "num": num,
        "room_name": body.room_name,
        "outcome": body.outcome,
        "room": body.room,
        "steps": body.steps,
        "state": body.state,
    }
    runs.append(entry)
    _save_history(runs)
    return {"num": num}


@app.get("/api/history")
def list_history() -> dict:
    """Summaries only (newest first), for the history list."""
    runs = _load_history()
    return {"runs": [{"num": r["num"], "room_name": r["room_name"], "outcome": r["outcome"]} for r in reversed(runs)]}


@app.delete("/api/history")
def clear_history() -> dict:
    """Wipe all recorded runs."""
    _save_history([])
    return {"ok": True}


@app.get("/api/history/{num}")
def get_history(num: int) -> dict:
    """Full record (room + steps + state) so a past run can be replayed."""
    for r in _load_history():
        if r["num"] == num:
            return r
    raise HTTPException(status_code=404, detail="History entry not found.")


# --- sessions --------------------------------------------------------------

@app.post("/api/session")
def create_session(body: CreateSessionBody) -> dict:
    session_id = uuid.uuid4().hex[:12]
    SESSIONS[session_id] = {
        "state": game.GameState(body.room),
        "api_key": body.api_key,
        "model": body.model,
        "move_limit": max(1, body.move_limit),
        "provider": body.provider,
    }
    return {
        "session_id": session_id,
        "state": SESSIONS[session_id]["state"].snapshot(),
    }


@app.get("/api/session/{session_id}/state")
def get_state(session_id: str) -> dict:
    session = _get_session(session_id)
    return session["state"].snapshot()


@app.delete("/api/session/{session_id}")
def delete_session(session_id: str) -> dict:
    SESSIONS.pop(session_id, None)
    return {"ok": True}


# --- the agentic loop (SSE) ------------------------------------------------

@app.get("/api/session/{session_id}/run")
def run_session(session_id: str):
    session = _get_session(session_id)

    def event_stream():
        for event in run_agent(
            session["state"],
            api_key=session["api_key"],
            model=session["model"],
            move_limit=session["move_limit"],
            provider=session.get("provider", "auto"),
        ):
            yield f"data: {json.dumps(event)}\n\n"
        yield "event: end\ndata: {}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# --- action APIs (each tool, callable directly) ----------------------------

@app.post("/api/session/{session_id}/actions/look_around")
def action_look_around(session_id: str) -> dict:
    session = _get_session(session_id)
    text = session["state"].look_around()
    return {"result": text, "state": session["state"].snapshot()}


@app.post("/api/session/{session_id}/actions/investigate_item")
def action_investigate(session_id: str, body: InvestigateBody) -> dict:
    session = _get_session(session_id)
    text = session["state"].investigate_item(body.item_name)
    return {"result": text, "state": session["state"].snapshot()}


@app.post("/api/session/{session_id}/actions/use_item_on_target")
def action_use_item(session_id: str, body: UseItemBody) -> dict:
    session = _get_session(session_id)
    text = session["state"].use_item_on_target(body.item_to_use, body.target_object)
    return {"result": text, "state": session["state"].snapshot()}


@app.post("/api/session/{session_id}/actions/escape")
def action_escape(session_id: str) -> dict:
    session = _get_session(session_id)
    text = session["state"].escape()
    return {"result": text, "state": session["state"].snapshot()}
