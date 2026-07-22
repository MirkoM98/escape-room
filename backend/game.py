"""
Escape Room — game state engine + local tool execution logic.

This module knows nothing about Claude. It is a plain, deterministic state
machine: the agentic loop (agent.py) asks it to resolve a tool call, and it
mutates the room and returns a human-readable result string that gets fed
straight back to the model as a tool_result.
"""

import copy


# The room the agent wakes up in. The frontend puzzle editor can override this
# when it creates a session, but this is the canonical default puzzle.
DEFAULT_ROOM = {
    "items": [
        {
            "id": "door",
            "name": "door",
            "description": "The main exit door. It has a keyhole.",
            "isLocked": True,
            "keyRequired": "brass_key",
            "isExit": True,
            "isVisible": True,
            "x": 2, "y": 0,
        },
        {
            "id": "box_1",
            "name": "box 1",
            "description": "A metal box with a 4-digit keypad.",
            "isLocked": True,
            "codeRequired": "4829",
            "holdsItem": "brass_key",
            "isVisible": True,
            "x": 1, "y": 2,
        },
        {
            "id": "table_1",
            "name": "table 1",
            "description": "A dusty wooden table.",
            "clue": "Taped underneath is a sticky note that reads: 'Box Code: 4829'",
            "isVisible": True,
            "x": 3, "y": 2,
        },
    ],
    "inventory": [],
}


# Ready-made rooms to demonstrate the agentic loop. Each is a plain room dict
# (same shape the frontend editor produces).
PRESETS = [
    {
        "id": "classic",
        "name": "Classic — clue → code → key → door",
        "description": "A table hints the box code; the box holds the door key. ~5 moves.",
        "room": DEFAULT_ROOM,
    },
    {
        "id": "five_keys",
        "name": "Five keys — only one opens the door",
        "description": "5 boxes, a key in each, NO hint which one fits the door. The agent must reason and try keys.",
        "room": {
            "items": [
                {"id": "door", "name": "door", "description": "A heavy exit door with a keyhole.", "isLocked": True, "keyRequired": "key_3", "isExit": True, "x": 2, "y": 0},
                {"id": "box_1", "name": "box 1", "description": "A wooden box.", "holdsItem": "key_1", "x": 0, "y": 2},
                {"id": "box_2", "name": "box 2", "description": "A wooden box.", "holdsItem": "key_2", "x": 1, "y": 2},
                {"id": "box_3", "name": "box 3", "description": "A wooden box.", "holdsItem": "key_3", "x": 2, "y": 2},
                {"id": "box_4", "name": "box 4", "description": "A wooden box.", "holdsItem": "key_4", "x": 3, "y": 2},
                {"id": "box_5", "name": "box 5", "description": "A wooden box.", "holdsItem": "key_5", "x": 4, "y": 2},
            ],
            "inventory": [],
        },
    },
    {
        "id": "hinted_keys",
        "name": "Hinted keys — grab the brass key, skip the rest",
        "description": "Same 5 boxes as Five keys, but a book NAMES the brass key. With the hint the agent should open boxes only until the brass key turns up (box 3) and skip the last two — instead of collecting all 5 keys and trying each on the door.",
        "room": {
            "items": [
                {"id": "door", "name": "door", "description": "A heavy exit door with a keyhole.", "isLocked": True, "keyRequired": "brass_key", "isExit": True, "x": 2, "y": 0},
                {"id": "book", "name": "book", "description": "An old book lies in the corner.", "clue": "To leave you need the BRASS key. It is inside one of the boxes — the other keys fit nothing here.", "x": 0, "y": 0},
                {"id": "box_1", "name": "box 1", "description": "A wooden box.", "holdsItem": "iron_key", "x": 0, "y": 2},
                {"id": "box_2", "name": "box 2", "description": "A wooden box.", "holdsItem": "tin_key", "x": 1, "y": 2},
                {"id": "box_3", "name": "box 3", "description": "A wooden box.", "holdsItem": "brass_key", "x": 2, "y": 2},
                {"id": "box_4", "name": "box 4", "description": "A wooden box.", "holdsItem": "copper_key", "x": 3, "y": 2},
                {"id": "box_5", "name": "box 5", "description": "A wooden box.", "holdsItem": "silver_key", "x": 4, "y": 2},
            ],
            "inventory": [],
        },
    },
    {
        "id": "hinted_codes",
        "name": "Hinted codes — take the door code, skip the rest",
        "description": "The codes version of Hinted keys. Five boxes each hold a note with a code for a DIFFERENT lock; a book says you only need the one labelled for the DOOR (box 3). The agent should read that code and skip the remaining boxes.",
        "room": {
            "items": [
                {"id": "door", "name": "door", "description": "The exit door has a 4-digit keypad.", "isLocked": True, "codeRequired": "7391", "isExit": True, "x": 2, "y": 0},
                {"id": "book", "name": "book", "description": "An old book lies in the corner.", "clue": "Each box holds a note with a code for a different lock. You only need the one labelled for the DOOR.", "x": 0, "y": 0},
                {"id": "box_1", "name": "box 1", "description": "A wooden box.", "clue": "Inside is a note: 'SAFE code: 1111'.", "x": 0, "y": 2},
                {"id": "box_2", "name": "box 2", "description": "A wooden box.", "clue": "Inside is a note: 'CABINET code: 2222'.", "x": 1, "y": 2},
                {"id": "box_3", "name": "box 3", "description": "A wooden box.", "clue": "Inside is a note: 'DOOR code: 7391'.", "x": 2, "y": 2},
                {"id": "box_4", "name": "box 4", "description": "A wooden box.", "clue": "Inside is a note: 'DRAWER code: 4444'.", "x": 3, "y": 2},
                {"id": "box_5", "name": "box 5", "description": "A wooden box.", "clue": "Inside is a note: 'WINDOW code: 5555'.", "x": 4, "y": 2},
            ],
            "inventory": [],
        },
    },
    {
        "id": "book_hint",
        "name": "Book hint — find the brass key",
        "description": "A book says the door needs a brass key. It's in one of the boxes (the others are decoys).",
        "room": {
            "items": [
                {"id": "door", "name": "door", "description": "The exit door has a keyhole.", "isLocked": True, "keyRequired": "brass_key", "isExit": True, "x": 2, "y": 0},
                {"id": "book", "name": "book", "description": "An old book lies in the corner.", "clue": "To leave, you need a BRASS key. Try the boxes — only one holds it.", "x": 0, "y": 0},
                {"id": "box_1", "name": "box 1", "description": "A dusty box.", "holdsItem": "iron_key", "x": 0, "y": 2},
                {"id": "box_2", "name": "box 2", "description": "A dusty box.", "holdsItem": "tin_key", "x": 2, "y": 2},
                {"id": "box_3", "name": "box 3", "description": "A dusty box.", "holdsItem": "brass_key", "x": 4, "y": 2},
                {"id": "box_4", "name": "box 4", "description": "A dusty box.", "x": 2, "y": 3},
            ],
            "inventory": [],
        },
    },
    {
        "id": "reasoning",
        "name": "Reasoning — derive the code, resist the decoy",
        "description": "The door needs a code you must COMPUTE from a rule. A fake code is planted to mislead a systematic searcher.",
        "room": {
            "items": [
                {"id": "door", "name": "door", "description": "The exit door has a 4-digit keypad.", "isLocked": True, "codeRequired": "2468", "isExit": True, "x": 2, "y": 0},
                {"id": "book", "name": "book", "description": "A worn notebook.", "clue": "The door code is the first four even numbers, in order. Ignore any codes you find lying around — they are decoys.", "x": 0, "y": 0},
                {"id": "note", "name": "sticky note", "description": "A sticky note on the wall.", "clue": "code: 1234", "x": 4, "y": 0},
                {"id": "box_1", "name": "box 1", "description": "A small box.", "holdsItem": "rusty_key", "x": 1, "y": 2},
                {"id": "chair_1", "name": "chair 1", "description": "A plain chair. Nothing under it.", "x": 3, "y": 2},
            ],
            "inventory": [],
        },
    },
    {
        "id": "nondeterministic",
        "name": "Non-deterministic proof — same room, different endings",
        "description": "The book shows 1234, but the door code is its REVERSE (4321). Sometimes the agent guesses the reversal and ESCAPES, sometimes it gives up (STUCK). Run it several times: identical room, different outcomes — that is impossible for a deterministic script.",
        "room": {
            "items": [
                {"id": "door", "name": "door", "description": "The exit door has a 4-digit keypad.", "isLocked": True, "codeRequired": "4321", "isExit": True, "x": 2, "y": 0},
                {"id": "book", "name": "book", "description": "An old book.", "clue": "Code: 1234", "x": 0, "y": 0},
                {"id": "chair_1", "name": "chair 1", "description": "A plain chair. Nothing under it.", "x": 4, "y": 2},
            ],
            "inventory": [],
        },
    },
    {
        "id": "nonsystemic",
        "name": "Non-systemic proof — assemble the code, ignore the decoy",
        "description": "The real door code is written NOWHERE. It must be assembled from four positional clues (digit 1 is 3, digit 2 is 5, ...). A systematic 'try every code you find' approach only finds a decoy (0000) and fails — only reasoning wins.",
        "room": {
            "items": [
                {"id": "door", "name": "door", "description": "The exit door has a 4-digit keypad.", "isLocked": True, "codeRequired": "3524", "isExit": True, "x": 2, "y": 0},
                {"id": "painting", "name": "painting", "description": "A framed painting.", "clue": "The 1st digit of the door code is 3.", "x": 0, "y": 0},
                {"id": "clock", "name": "clock", "description": "A wall clock.", "clue": "The 2nd digit of the door code is 5.", "x": 4, "y": 0},
                {"id": "rug", "name": "rug", "description": "A woven rug.", "clue": "The 3rd digit of the door code is 2.", "x": 1, "y": 2},
                {"id": "vase", "name": "vase", "description": "A ceramic vase.", "clue": "The 4th digit of the door code is 4.", "x": 3, "y": 2},
                {"id": "note", "name": "sticky note", "description": "A sticky note.", "clue": "code: 0000", "x": 2, "y": 3},
            ],
            "inventory": [],
        },
    },
    {
        "id": "unsolvable",
        "name": "Dead end — no way out (agent should give up)",
        "description": "The door needs a golden key that exists NOWHERE in the room. The agent explores everything, then concludes 'I can't solve it'.",
        "room": {
            "items": [
                {"id": "door", "name": "door", "description": "A solid steel door with a single keyhole. No keypad.", "isLocked": True, "keyRequired": "golden_key", "isExit": True, "x": 2, "y": 0},
                {"id": "note", "name": "note", "description": "A faded note.", "clue": "This door only opens with the GOLDEN KEY. Nothing else will work.", "x": 0, "y": 0},
                {"id": "box_1", "name": "box 1", "description": "A cardboard box.", "holdsItem": "spoon", "x": 1, "y": 2},
                {"id": "box_2", "name": "box 2", "description": "A cardboard box.", "holdsItem": "coin", "x": 3, "y": 2},
                {"id": "drawer_1", "name": "drawer 1", "description": "An empty drawer.", "x": 4, "y": 2},
                {"id": "chair_1", "name": "chair 1", "description": "A plain chair. Nothing under it.", "x": 2, "y": 3},
            ],
            "inventory": [],
        },
    },
]


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
    }


class GameState:
    """Mutable state for a single escape-room session."""

    def __init__(self, room: dict | None = None):
        room = copy.deepcopy(room or DEFAULT_ROOM)
        self.items: list[dict] = room.get("items", [])
        self.inventory: list[str] = list(room.get("inventory", []))
        self.escaped: bool = False
        # Give every object an explicit status field (its state-machine value).
        for it in self.items:
            it["status"] = _init_status(it)

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
        parts = [item.get("description", "").strip()]
        if item.get("clue"):
            parts.append(item["clue"].strip())
        # A passive object (a clue/furniture with no lock) becomes "examined".
        if item.get("status") == "unexamined":
            item["status"] = "examined"
        text = " ".join(p for p in parts if p)
        return text or f"You inspect the {item['name']} but find nothing of note."

    def use_item_on_target(self, item_to_use: str, target_object: str) -> str:
        target = self.find(target_object)
        if target is None:
            return f"There is no '{target_object}' to use that on."

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

        # Anything else — wrong code, wrong key, key you don't hold, using scenery,
        # a target with no lock — gives no hint. Just like a real escape room.
        return f"Nothing happens when you use '{item_to_use}' on '{target_object}'."

    def escape(self) -> str:
        door = self.door()
        if door is not None and not door.get("isLocked", True):
            self.escaped = True
            door["status"] = "escaped"
            return "SUCCESS! You have opened the door and escaped the room!"
        return "The door is still locked. You cannot escape yet."


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
