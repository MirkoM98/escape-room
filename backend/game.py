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
        "id": "atomic_vault",
        "name": "Atomic Vault — only gold opens it",
        "description": (
            "The door code is the atomic number of gold (Au). No number is written anywhere "
            "in the room — you must retrieve it from world knowledge. A torn periodic-table "
            "page plants Group 11 and Period 6 as decoys; one wrong entry jams the lock forever. "
            "A regex scanner finds no valid candidate. Only an agent with chemistry knowledge escapes."
        ),
        "room": {
            "items": [
                {"id": "door", "name": "door", "description": "A heavy vault door with a numeric keypad. A warning placard reads: ONE wrong entry will jam this lock permanently.", "isLocked": True, "codeRequired": "79", "maxAttempts": 1, "isExit": True, "x": 2, "y": 0},
                {"id": "plaque", "name": "plaque", "description": "A brass plaque bolted to the wall.", "clue": "To open the vault, enter the atomic number of gold (Au). One wrong attempt and the mechanism seizes for good.", "x": 0, "y": 0},
                {"id": "periodic_table", "name": "periodic table", "description": "A torn page from a chemistry textbook pinned to the wall. The precious-metals section is visible.", "clue": "Au is listed at Group 11, Period 6. Someone has circled the number 11 in red ink.", "x": 4, "y": 0},
                {"id": "chair_1", "name": "chair 1", "description": "A plain chair. Nothing under it.", "x": 2, "y": 2},
            ],
            "inventory": [],
        },
    },
    {
        "id": "miracle_on_ice",
        "name": "Miracle on Ice — Lake Placid, 1980",
        "description": (
            "The door code is USA's goal count in the famous 1980 Winter Olympics ice-hockey "
            "semifinal against the Soviet Union — 'Do you believe in miracles?' The Soviet "
            "score (3) is visible on a scoreboard as a decoy; the winning US score (4) appears "
            "nowhere in the room. One wrong entry jams the lock. A script tries the visible 3 "
            "and loses. Only an agent with sports-history knowledge escapes."
        ),
        "room": {
            "items": [
                {"id": "door", "name": "door", "description": "A locker-room door with a single-digit keypad. A taped note reads: ONE wrong code and this lock seizes permanently.", "isLocked": True, "codeRequired": "4", "maxAttempts": 1, "isExit": True, "x": 2, "y": 0},
                {"id": "poster", "name": "poster", "description": "A faded sports poster on the wall.", "clue": "Lake Placid, 1980 Winter Olympics. USA vs Soviet Union, ice-hockey semifinal. 'Do you believe in miracles?' The code is the number of goals scored by the winning team.", "x": 0, "y": 0},
                {"id": "scoreboard", "name": "scoreboard", "description": "An old manual scoreboard hanging crookedly.", "clue": "HOME (Soviet Union): 3 | AWAY (USA): the away score has been deliberately scratched out.", "x": 4, "y": 2},
                {"id": "chair_1", "name": "chair 1", "description": "A plain bench. Nothing underneath.", "x": 2, "y": 2},
            ],
            "inventory": [],
        },
    },
    {
        "id": "summit_code",
        "name": "Summit Code — the height of the world",
        "description": (
            "The door code is the official height of Mount Everest in metres as announced "
            "by the Nepal-China joint survey in 2020 (8849). An old atlas page shows a rough "
            "early estimate of 8,000 m as a decoy. One wrong entry jams the lock. A script "
            "that tries 8000 is done. Only an agent with up-to-date geographic knowledge escapes."
        ),
        "room": {
            "items": [
                {"id": "door", "name": "door", "description": "A reinforced door with a 4-digit keypad. A metal sign warns: ONLY ONE ATTEMPT PERMITTED. A wrong code jams the mechanism permanently.", "isLocked": True, "codeRequired": "8849", "maxAttempts": 1, "isExit": True, "x": 2, "y": 0},
                {"id": "journal", "name": "journal", "description": "A mountaineer's journal left on the floor.", "clue": "To escape, enter the official height of Mount Everest above sea level in metres, as announced by Nepal and China in their 2020 joint survey.", "x": 0, "y": 0},
                {"id": "atlas", "name": "atlas", "description": "A torn page from an old geographic atlas.", "clue": "Everest elevation — early rough estimate: 8,000 m (subject to resurvey). This figure predates modern satellite measurement.", "x": 4, "y": 2},
                {"id": "chair_1", "name": "chair 1", "description": "A plain chair. Nothing under it.", "x": 2, "y": 2},
            ],
            "inventory": [],
        },
    },
    {
        "id": "first_footstep",
        "name": "First Footstep — the year we touched the Moon",
        "description": (
            "The door code is the year Neil Armstrong first stepped onto the lunar surface. "
            "A mission-control timeline on the wall shows 1968 (the year of Apollo 8's first "
            "crewed lunar orbit) as a prominent decoy — a script extracts 1968 and jams the "
            "lock on its one permitted attempt. Only an agent that distinguishes 'first orbit' "
            "from 'first footstep' (1969) escapes."
        ),
        "room": {
            "items": [
                {"id": "door", "name": "door", "description": "A door with a 4-digit year keypad. A handwritten sign is taped beside it: FRAGILE — one wrong year and this lock jams for good.", "isLocked": True, "codeRequired": "1969", "maxAttempts": 1, "isExit": True, "x": 2, "y": 0},
                {"id": "plaque", "name": "plaque", "description": "A commemorative plaque on the wall.", "clue": "The code is the year Neil Armstrong first set foot on the surface of the Moon.", "x": 0, "y": 0},
                {"id": "timeline", "name": "timeline", "description": "A mission-control timeline chart pinned to the wall.", "clue": "Apollo program milestones — First crewed lunar orbit: 1968 (Apollo 8, December). First lunar footstep: [REDACTED].", "x": 4, "y": 2},
                {"id": "chair_1", "name": "chair 1", "description": "A plain chair. Nothing under it.", "x": 2, "y": 2},
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
        "id": "capstone",
        "name": "One-shot lock — reason it out, or jam it forever",
        "description": (
            "The strongest single demo of a real agent. Three properties at once: "
            "(1) NON-SYSTEMATIC — the door code is written NOWHERE; you must DERIVE it "
            "(reverse the number on the clock), and a decoy note shows the literal wrong "
            "code. (2) IRREVERSIBLE STAKES — the keypad is fragile: ONE wrong entry jams it "
            "for good and dooms the room, so a brute-forcer that 'tries the code it found' "
            "enters the decoy and loses. (3) NON-DETERMINISTIC — run it several times: same "
            "room, sometimes the agent derives 2413 and ESCAPES, sometimes it risks the decoy "
            "and JAMS. Only reasoning plus the restraint to act when certain gets out."
        ),
        "room": {
            "items": [
                {"id": "door", "name": "door", "description": "The exit door has a 4-digit keypad. The keypad is old and delicate — a note beside it warns that ONE wrong entry will jam it permanently.", "isLocked": True, "codeRequired": "2413", "maxAttempts": 1, "isExit": True, "x": 2, "y": 0},
                {"id": "painting", "name": "painting", "description": "A framed painting hangs crookedly.", "clue": "To open the door, read the number etched on the clock and enter its digits in REVERSE order.", "x": 0, "y": 0},
                {"id": "clock", "name": "clock", "description": "A stopped wall clock with a number etched across its face.", "clue": "The number etched on the clock is 3142.", "x": 4, "y": 0},
                {"id": "note", "name": "sticky note", "description": "A sticky note stuck by the door.", "clue": "code: 3142", "x": 2, "y": 3},
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
        "attempts": item.get("attempts"),
    }


class GameState:
    """Mutable state for a single escape-room session."""

    def __init__(self, room: dict | None = None):
        room = copy.deepcopy(room or DEFAULT_ROOM)
        self.items: list[dict] = room.get("items", [])
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
