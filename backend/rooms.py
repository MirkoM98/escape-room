"""
Escape Room — the room catalogue.

Pure data: the default puzzle plus the ready-made preset rooms the UI offers.
Kept apart from game.py so the engine stays readable on its own; each room is
the same plain dict the frontend grid editor produces.
"""

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
            "The door code is the long-accepted height of Mount Everest (8848 m). An old "
            "atlas page shows a rough estimate of 8,000 m as a decoy. Three wrong entries "
            "jam the lock for good. A script that tries 8000 fails; only an agent with "
            "geographic knowledge escapes."
        ),
        "room": {
            "items": [
                {"id": "door", "name": "door", "description": "A reinforced door with a 4-digit keypad. A metal sign warns: THREE wrong entries will jam this mechanism permanently.", "isLocked": True, "codeRequired": "8848", "maxAttempts": 3, "isExit": True, "x": 2, "y": 0},
                {"id": "journal", "name": "journal", "description": "A mountaineer's journal left on the floor.", "clue": "To escape, enter the official height of Mount Everest above sea level in metres, as announced by Nepal and China in their 2020 joint survey. max 4 digits", "x": 0, "y": 0},
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
