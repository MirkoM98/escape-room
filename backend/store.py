"""
Where a finished run is archived.

Three tiers, first one that works wins:
  1. Postgres, when a DATABASE_URL-style variable is set (a deployment)
  2. escaping-history.json, when the filesystem is writable (a laptop)
  3. nowhere, and that is fine: the browser keeps its own copy of every run in
     localStorage, so the UI never depends on this module succeeding.

The archive drops each step's raw request/response dump. Those are ~3KB per
step and the UI only needs them while a run is playing, not on replay.
"""

import json
import os

_URL_VARS = ("DATABASE_URL", "POSTGRES_URL", "DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING")

HISTORY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "escaping-history.json")

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    id         BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    room_name  TEXT        NOT NULL,
    outcome    TEXT        NOT NULL,
    moves      INTEGER     NOT NULL,
    room       JSONB       NOT NULL,
    steps      JSONB       NOT NULL,
    state      JSONB,
    legacy_num INTEGER UNIQUE
);
CREATE INDEX IF NOT EXISTS runs_room_outcome_idx ON runs (room_name, outcome);
CREATE INDEX IF NOT EXISTS runs_created_at_idx   ON runs (created_at DESC);
"""

_schema_ready = False


def database_url() -> str | None:
    for var in _URL_VARS:
        value = os.environ.get(var, "").strip()
        if value:
            return value
    return None


def file_writable() -> bool:
    return os.access(os.path.dirname(HISTORY_FILE), os.W_OK)


def describe() -> str:
    """Where a finished run would go right now. Surfaced by /api/health."""
    if database_url():
        return "postgres"
    if file_writable():
        return "file"
    return "none"


def without_llm_payloads(steps: list) -> list:
    return [
        {k: v for k, v in step.items() if k not in ("llmInput", "llmOutput")}
        for step in steps
        if isinstance(step, dict)
    ]


def count_moves(steps: list) -> int:
    return sum(1 for step in steps if isinstance(step, dict) and step.get("action"))


def ensure_schema(conn) -> None:
    global _schema_ready
    if _schema_ready:
        return
    with conn.cursor() as cur:
        cur.execute(SCHEMA)
    conn.commit()
    _schema_ready = True


def _save_to_postgres(url: str, record: dict) -> dict:
    import psycopg

    steps = without_llm_payloads(record.get("steps") or [])
    with psycopg.connect(url, connect_timeout=10) as conn:
        ensure_schema(conn)
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO runs (room_name, outcome, moves, room, steps, state)"
                " VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
                (
                    record.get("room_name") or "Custom room",
                    record.get("outcome") or "Ended",
                    count_moves(steps),
                    json.dumps(record.get("room") or {}),
                    json.dumps(steps),
                    json.dumps(record.get("state")) if record.get("state") else None,
                ),
            )
            (run_id,) = cur.fetchone()
        conn.commit()
    return {"saved": True, "store": "postgres", "num": run_id}


def _save_to_file(record: dict) -> dict:
    try:
        with open(HISTORY_FILE) as f:
            runs = json.load(f).get("runs", [])
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        runs = []
    num = (runs[-1].get("num", 0) + 1) if runs else 1
    runs.append({
        "num": num,
        "room_name": record.get("room_name") or "Custom room",
        "outcome": record.get("outcome") or "Ended",
        "room": record.get("room") or {},
        "steps": without_llm_payloads(record.get("steps") or []),
        "state": record.get("state"),
    })
    with open(HISTORY_FILE, "w") as f:
        json.dump({"runs": runs}, f, indent=2)
    return {"saved": True, "store": "file", "num": num}


def save_run(record: dict) -> dict:
    url = database_url()
    if url:
        try:
            return _save_to_postgres(url, record)
        except Exception as exc:  # noqa: BLE001 — never fail a run over its archive
            return {"saved": False, "store": "postgres", "reason": str(exc)[:200]}
    if file_writable():
        try:
            return _save_to_file(record)
        except OSError as exc:
            return {"saved": False, "store": "file", "reason": str(exc)[:200]}
    return {"saved": False, "store": "none", "reason": "no writable store"}
