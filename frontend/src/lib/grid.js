export const GRID = 5;
export const AGENT_START = { x: 2, y: 4 };

export const CANDIDATE_CELLS = [
  [2, 0], [1, 2], [3, 2], [0, 1], [4, 1], [2, 2], [0, 3], [4, 3], [1, 0], [3, 0], [2, 3], [0, 0],
];

export const norm = (s) => String(s || "").trim().toLowerCase().replace(/[_\s]/g, "");

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const cellPct = (v) => ((v + 0.5) / GRID) * 100;

export function iconFor(item) {
  if (item.icon) return item.icon;
  const n = (item.name || "").toLowerCase();
  const has = (...words) => words.some((w) => n.includes(w));
  if (has("vent", "duct", "shaft", "grate")) return "🕳️";
  if (has("window")) return "🪟";
  if (has("door", "exit", "hatch", "gate")) return "🚪";
  if (has("plaque", "placard", "sign")) return "🪧";
  if (has("sticky", "note", "paper", "letter", "envelope")) return "📝";
  if (has("periodic")) return "⚛️";
  if (has("scoreboard", "score")) return "🔢";
  if (has("poster", "paint", "picture", "frame", "portrait")) return "🖼️";
  if (has("map", "globe")) return "🗺️";
  if (has("journal", "diary", "atlas", "timeline", "book", "shelf", "manual")) return "📖";
  if (has("newspaper", "press")) return "📰";
  if (has("clock", "watch")) return "🕰️";
  if (has("hourglass", "timer")) return "⏳";
  if (has("safe", "vault")) return "🔐";
  if (has("padlock", "lock")) return "🔒";
  if (has("chest", "box", "crate", "carton", "parcel")) return "📦";
  if (has("suitcase", "briefcase", "luggage", "bag")) return "💼";
  if (has("drawer", "cabinet", "locker", "file")) return "🗄️";
  if (has("chair", "bench", "stool", "seat")) return "🪑";
  if (has("table", "desk", "counter")) return "🪑";
  if (has("bed", "bunk", "mattress")) return "🛏️";
  if (has("mirror")) return "🪞";
  if (has("wall", "brick")) return "🧱";
  if (has("ladder", "stair", "step")) return "🪜";
  if (has("candle")) return "🕯️";
  if (has("lamp", "light", "bulb", "torch")) return "💡";
  if (has("fire", "hearth", "stove")) return "🔥";
  if (has("phone", "telephone")) return "☎️";
  if (has("radio", "speaker", "stereo")) return "📻";
  if (has("computer", "laptop", "terminal", "screen", "monitor", "tv")) return "💻";
  if (has("camera")) return "📷";
  if (has("battery")) return "🔋";
  if (has("wire", "cable", "cord")) return "🔌";
  if (has("switch", "lever", "button", "dial", "keypad")) return "🎛️";
  if (has("pipe", "valve", "tap", "faucet")) return "🚰";
  if (has("car", "truck", "van")) return "🚗";
  if (has("bike", "bicycle")) return "🚲";
  if (has("statue", "bust", "sculpture")) return "🗿";
  if (has("skull", "bone", "skeleton")) return "💀";
  if (has("coffin", "grave", "tomb")) return "⚰️";
  if (has("potion", "flask", "vial", "chemical")) return "🧪";
  if (has("bottle", "jar", "flagon")) return "🍾";
  if (has("cup", "mug", "glass")) return "☕";
  if (has("food", "bread", "apple", "fruit")) return "🍎";
  if (has("coin", "money", "cash", "gold")) return "🪙";
  if (has("gem", "jewel", "diamond", "ruby")) return "💎";
  if (has("crown")) return "👑";
  if (has("ring")) return "💍";
  if (has("sword", "blade", "dagger", "knife")) return "🗡️";
  if (has("shield", "armor", "armour")) return "🛡️";
  if (has("ticket", "pass", "stub")) return "🎫";
  if (has("calendar", "date")) return "📅";
  if (has("card", "badge", "id")) return "🪪";
  if (has("key")) return "🗝️";
  if (has("plant", "pot", "flower", "tree")) return "🪴";
  if (has("rug", "carpet", "mat")) return "🧶";
  if (has("clothes", "coat", "jacket", "shirt")) return "🧥";
  if (has("shoe", "boot")) return "🥾";
  if (has("bin", "trash", "waste", "basket")) return "🗑️";
  if (has("puzzle", "piece")) return "🧩";
  if (has("dice", "die")) return "🎲";
  if (has("music", "piano", "guitar", "record")) return "🎵";
  if (item.isExit) return "🚪";
  return "📦";
}

export function assignPositions(list) {
  const used = new Set();
  list.forEach((it) => {
    if (Number.isFinite(it.x) && Number.isFinite(it.y)) used.add(`${it.x},${it.y}`);
  });
  let ci = 0;
  return list.map((it) => {
    if (Number.isFinite(it.x) && Number.isFinite(it.y)) return it;
    let cell;
    if (it.isExit) {
      cell = [Math.floor(GRID / 2), 0];
    } else {
      while (ci < CANDIDATE_CELLS.length && used.has(CANDIDATE_CELLS[ci].join(","))) ci++;
      cell = CANDIDATE_CELLS[ci] || [ci % GRID, Math.min(GRID - 1, 2 + Math.floor(ci / GRID))];
      ci++;
    }
    used.add(cell.join(","));
    return { ...it, x: cell[0], y: cell[1] };
  });
}

export function freeCell(list) {
  const used = new Set(list.map((it) => `${it.x},${it.y}`));
  for (const [x, y] of CANDIDATE_CELLS) if (!used.has(`${x},${y}`)) return { x, y };
  for (let y = 1; y < GRID; y++) for (let x = 0; x < GRID; x++) if (!used.has(`${x},${y}`)) return { x, y };
  return { x: 4, y: 4 };
}
