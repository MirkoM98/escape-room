"""
Escape Room — game state engine + local tool execution logic.

This module knows nothing about Claude. It is a plain, deterministic state
machine: the agentic loop (agent.py) asks it to resolve a tool call, and it
mutates the room and returns a human-readable result string that gets fed
straight back to the model as a tool_result.

The rooms themselves live in rooms.py.
"""

import copy

from .rooms import DEFAULT_ROOM

def _norm(value) -> str:
    """Normalize a reference so 'box 1', 'box_1' and 'Box1' all match."""
    return str(value or "").strip().lower().replace("_", "").replace(" ", "")


def _is_door(item: dict) -> bool:
    return bool(item.get("isExit") or item.get("id") == "locked_door" or "door" in _norm(item.get("name")))


def _init_status(item: dict) -> str:
    """Initial status field for an object (its little state machine value)."""
    if item.get("status"):
        return item["status"]
    if _is_door(item):
        return "locked" if item.get("isLocked") else "unlocked"
    if item.get("codeRequired") or item.get("keyRequired") or item.get("holdsItem"):
        return "locked" if item.get("isLocked") else "unlocked"
    return "unexamined"


def _snap(item: dict | None) -> dict | None:
    """Small snapshot of the fields that change, for before/after diffs."""
    if item is None:
        return None
    return {
        "status": item.get("status"),
        "isLocked": item.get("isLocked"),
        "holdsItem": item.get("holdsItem"),
        "attempts": item.get("attempts"),
    }


class GameState:
    """Mutable state for a single escape-room session."""

    def __init__(self, room: dict | None = None):
        room = copy.deepcopy(room or DEFAULT_ROOM)
        self.items: list[dict] = [it for it in room.get("items", []) if isinstance(it, dict)]
        self.inventory: list[str] = list(room.get("inventory", []))
        self.escaped: bool = False
        # Give every object an explicit status field (its state-machine value)
        # and a wrong-attempt counter for the fragile-lock (jam) mechanic.
        for it in self.items:
            it["status"] = _init_status(it)
            it.setdefault("attempts", 0)

    # --- lookups -----------------------------------------------------------

    def find(self, ref: str) -> dict | None:
        target = _norm(ref)
        for item in self.items:
            if _norm(item.get("name")) == target or _norm(item.get("id")) == target:
                return item
        return None

    def door(self) -> dict | None:
        return next((it for it in self.items if _is_door(it)), None)

    def _has_in_inventory(self, ref: str) -> bool:
        return _norm(ref) in {_norm(x) for x in self.inventory}

    def snapshot(self) -> dict:
        """A JSON-serializable view of the room for the frontend live panel."""
        return {
            "items": copy.deepcopy(self.items),
            "inventory": list(self.inventory),
            "escaped": self.escaped,
        }

    def context_footer(self) -> str:
        """A grounding reminder appended to every tool result the agent sees.

        Keeps the agent aware of what actually exists and what it is carrying,
        so it stops trying objects that aren't there or 'using' items it does
        not have. Does NOT reveal locked/unlocked status.
        """
        names = [it["name"] for it in self.items if it.get("isVisible", True)]
        room = ", ".join(names) if names else "(nothing)"
        inv = ", ".join(self.inventory) if self.inventory else "(nothing)"
        return f"[You can see: {room}. You are carrying: {inv}.]"

    # --- tools -------------------------------------------------------------

    def look_around(self) -> str:
        # Only names — the agent must investigate an item (or try it) to learn
        # whether it is locked. Looking around gives no lock/status information.
        visible = [it for it in self.items if it.get("isVisible", True)]
        if not visible:
            return "The room is pitch black — you can't make anything out."
        lines = ["You scan the room and see:"]
        for it in visible:
            lines.append(f"- {it['name']}")
        if self.inventory:
            lines.append(f"Your inventory: {', '.join(self.inventory)}.")
        else:
            lines.append("Your inventory is empty.")
        return "\n".join(lines)

    def investigate_item(self, item_name: str) -> str:
        item = self.find(item_name)
        if item is None:
            return f"There is no '{item_name}' here to investigate."

        # A container hands over whatever it holds as soon as it is NOT locked.
        # (Items with no lock at all count as unlocked — e.g. a loose brick.)
        if item.get("holdsItem") and not item.get("isLocked"):
            held = item["holdsItem"]
            item["holdsItem"] = None
            item["status"] = "emptied"
            if not self._has_in_inventory(held):
                self.inventory.append(held)
            return (
                f"You found a {held} inside the {item['name']}! "
                f"It has been added to your inventory."
            )

        # NOTE: we deliberately do NOT reveal locked/unlocked here. The agent
        # only learns something is locked when it actually tries to open it.
        text = (item.get("description") or "").strip()
        # A passive object (furniture with no lock) becomes "examined".
        if item.get("status") == "unexamined":
            item["status"] = "examined"
        return text or f"You inspect the {item['name']} but find nothing of note."

    def use_item_on_target(self, item_to_use: str, target_object: str) -> str:
        target = self.find(target_object)
        if target is None:
            return f"There is no '{target_object}' to use that on."

        # A jammed lock is dead forever — no code or key will ever open it.
        if target.get("status") == "jammed":
            return (
                f"The {target['name']}'s mechanism is jammed solid. "
                f"It will never open now — nothing you do can undo that."
            )

        has_lock = target.get("codeRequired") is not None or target.get("keyRequired") is not None

        # A code opens a coded lock.
        if target.get("codeRequired") is not None:
            if str(item_to_use).strip() == str(target["codeRequired"]).strip():
                if not target.get("isLocked"):
                    return f"The {target['name']} is already unlocked."
                target["isLocked"] = False
                target["status"] = "unlocked"
                return f"The code is correct! The {target['name']} clicks open — it is now unlocked."

        # A key opens a keyed lock — but only if you actually hold it.
        if target.get("keyRequired") is not None:
            if _norm(item_to_use) == _norm(target["keyRequired"]) and self._has_in_inventory(item_to_use):
                if not target.get("isLocked"):
                    return f"The {target['name']} is already unlocked."
                target["isLocked"] = False
                target["status"] = "unlocked"
                return f"The {target['keyRequired']} turns with a heavy thud! The {target['name']} is now unlocked."

        # --- wrong attempt --------------------------------------------------
        # A fragile lock (maxAttempts set) tolerates only so many WRONG tries on
        # a still-locked object; the next wrong try jams it permanently. This is
        # the universal "you can break the puzzle" mechanic: it works on ANY
        # lockable object (door, box, safe...) just by giving it maxAttempts.
        max_attempts = target.get("maxAttempts")
        if has_lock and target.get("isLocked") and max_attempts:
            target["attempts"] = int(target.get("attempts", 0)) + 1
            remaining = int(max_attempts) - target["attempts"]
            if remaining <= 0:
                target["status"] = "jammed"
                return (
                    f"WRONG — and that was one wrong try too many. The {target['name']}'s "
                    f"mechanism JAMS with a grinding snap. It is now permanently stuck; "
                    f"it can NEVER be opened, even with the correct code or key."
                )
            return (
                f"Nothing happens — '{item_to_use}' is not right for the {target['name']}, "
                f"and you feel the mechanism strain. It looks like only {remaining} more "
                f"wrong attempt(s) before it jams for good."
            )

        # Anything else — wrong code, wrong key, key you don't hold, using scenery,
        # a target with no lock — gives no hint. Just like a real escape room.
        return f"Nothing happens when you use '{item_to_use}' on '{target_object}'."

    def escape(self) -> str:
        # A room can have MORE THAN ONE exit (e.g. the door AND a ventilation
        # shaft). You escape through whichever exit is currently unlocked —
        # not just the first one found.
        exits = [it for it in self.items if _is_door(it)]
        open_exit = next((it for it in exits if not it.get("isLocked", True)), None)
        if open_exit is not None:
            self.escaped = True
            open_exit["status"] = "escaped"
            return f"SUCCESS! You got through the {open_exit.get('name', 'exit')} and escaped the room!"
        if not exits:
            return "There is no exit here to escape through."
        return "The exit is still locked. You cannot escape yet."


# Which item a tool acts on (for the before/after state diff). None = whole room.
def _tool_target(state: GameState, name: str, tool_input: dict) -> dict | None:
    if name == "investigate_item":
        return state.find(tool_input.get("item_name", ""))
    if name == "use_item_on_target":
        return state.find(tool_input.get("target_object", ""))
    if name == "escape":
        return state.door()
    return None


def _run_tool(state: GameState, name: str, tool_input: dict) -> str:
    if name == "look_around":
        return state.look_around()
    if name == "investigate_item":
        return state.investigate_item(tool_input.get("item_name", ""))
    if name == "use_item_on_target":
        return state.use_item_on_target(
            tool_input.get("item_to_use", ""),
            tool_input.get("target_object", ""),
        )
    if name == "escape":
        return state.escape()
    return f"Unknown tool '{name}'."


# Runs the tool AND returns a structured state-update describing what changed.
# Returns (result_text, update) where update is:
#   {target, before, after, changed:[fields], solved:bool}
def execute_tool(state: GameState, name: str, tool_input: dict):
    tool_input = tool_input or {}
    target = _tool_target(state, name, tool_input)
    before = _snap(target)
    text = _run_tool(state, name, tool_input)
    after = _snap(target)

    changed = []
    if before and after:
        changed = [k for k in after if after.get(k) != before.get(k)]

    solved = bool(changed)  # this action moved the world forward
    if name == "escape":
        solved = state.escaped

    update = {
        "target": target.get("id") if target else None,
        "target_name": target.get("name") if target else None,
        "before": before,
        "after": after,
        "changed": changed,
        "solved": solved,
    }
    return text, update
