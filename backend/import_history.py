"""
One-off: copy escaping-history.json into the runs table.

Runs recorded before the database existed live in the JSON file. This moves
them across so the aggregate queries cover the whole history. Safe to re-run:
each row carries the file's own run number in legacy_num, which is UNIQUE, so
a second pass inserts nothing. Live runs leave legacy_num NULL, and Postgres
permits many NULLs under a UNIQUE constraint.

Run it from the repository root with the database credentials in the
environment (vercel env pull .env.local writes them):

    set -a && . ./.env.local && set +a
    python -m backend.import_history
"""

import json
import sys

import psycopg

from . import store


def main() -> None:
    url = store.database_url()
    if not url:
        raise SystemExit("No DATABASE_URL in the environment.")

    try:
        with open(store.HISTORY_FILE) as f:
            runs = json.load(f).get("runs", [])
    except (FileNotFoundError, json.JSONDecodeError) as exc:
        raise SystemExit(f"Could not read {store.HISTORY_FILE}: {exc}")

    inserted = skipped = 0
    with psycopg.connect(url, connect_timeout=20) as conn:
        store.ensure_schema(conn)
        with conn.cursor() as cur:
            for run in runs:
                steps = store.without_llm_payloads(run.get("steps") or [])
                cur.execute(
                    "INSERT INTO runs (room_name, outcome, moves, room, steps, state, legacy_num)"
                    " VALUES (%s, %s, %s, %s, %s, %s, %s)"
                    " ON CONFLICT (legacy_num) DO NOTHING",
                    (
                        run.get("room_name") or "Custom room",
                        run.get("outcome") or "Ended",
                        store.count_moves(steps),
                        json.dumps(run.get("room") or {}),
                        json.dumps(steps),
                        json.dumps(run.get("state")) if run.get("state") else None,
                        run.get("num"),
                    ),
                )
                if cur.rowcount:
                    inserted += 1
                else:
                    skipped += 1
        conn.commit()

    print(f"inserted {inserted}, skipped {skipped} already present", file=sys.stderr)


if __name__ == "__main__":
    main()
