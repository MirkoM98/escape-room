export const GRID = 5;
export const AGENT_START = { x: 2, y: 4 };

export const CANDIDATE_CELLS = [
  [2, 0], [1, 2], [3, 2], [0, 1], [4, 1], [2, 2], [0, 3], [4, 3], [1, 0], [3, 0], [2, 3], [0, 0],
];

export const norm = (s) => String(s || "").trim().toLowerCase().replace(/[_\s]/g, "");

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const cellPct = (v) => ((v + 0.5) / GRID) * 100;

export function iconFor(item) {
  const n = (item.name || "").toLowerCase();
  // Name wins over isExit, so an exit that is a vent/hatch keeps its own look
  // instead of turning into a door.
  if (n.includes("vent") || n.includes("duct") || n.includes("shaft") || n.includes("grate")) return "🕳️";
  if (n.includes("window")) return "🪟";
  if (n.includes("door") || n.includes("exit") || n.includes("hatch") || n.includes("gate")) return "🚪";
  if (n.includes("chest") || n.includes("box") || n.includes("crate")) return "📦";
  if (n.includes("table") || n.includes("desk")) return "🪑";
  if (n.includes("wall") || n.includes("brick")) return "🧱";
  if (n.includes("drawer") || n.includes("cabinet")) return "🗄️";
  if (n.includes("paint") || n.includes("picture") || n.includes("frame")) return "🖼️";
  if (n.includes("safe") || n.includes("vault")) return "🔐";
  if (n.includes("key")) return "🗝️";
  if (n.includes("plant") || n.includes("pot")) return "🪴";
  if (n.includes("rug") || n.includes("carpet")) return "🧶";
  if (n.includes("book") || n.includes("shelf")) return "📚";
  if (n.includes("clock")) return "🕰️";
  if (n.includes("lamp") || n.includes("light")) return "💡";
  if (item.isExit) return "🚪";   // an exit with an unrecognized name still reads as a way out
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
