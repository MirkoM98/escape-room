import { EMOJI } from "./emoji-data";

// emojilib orders its keywords by appearance, not by how people name a thing:
// 🚗 is primarily "automobile" with "car" fifth, and 📦 is "package" with "box"
// fifth. No ranking over that data puts the obvious pick first, so the words
// people actually reach for when dressing a room are pinned here.
const PREFERRED = {
  box: "📦", crate: "📦", parcel: "📦", package: "📦",
  car: "🚗", truck: "🚚", van: "🚐", bike: "🚲",
  key: "🔑", keys: "🔑", keycard: "🪪",
  door: "🚪", gate: "🚪", hatch: "🚪", exit: "🚪",
  chair: "🪑", table: "🪑", desk: "🪑", stool: "🪑", bench: "🪑",
  bed: "🛏️", sofa: "🛋️", couch: "🛋️",
  safe: "🔐", vault: "🔐", lock: "🔒", padlock: "🔒",
  phone: "☎️", telephone: "☎️", mobile: "📱",
  clock: "🕰️", watch: "⌚", timer: "⏳", hourglass: "⏳",
  lamp: "💡", light: "💡", bulb: "💡", candle: "🕯️", torch: "🔦",
  plant: "🪴", flower: "🌸", tree: "🌳",
  sword: "🗡️", dagger: "🗡️", knife: "🔪", axe: "🪓", hammer: "🔨",
  shield: "🛡️", gun: "🔫", bomb: "💣",
  bottle: "🍾", jar: "🫙", cup: "☕", mug: "☕", glass: "🥛", teapot: "🫖",
  spoon: "🥄", fork: "🍴", plate: "🍽️",
  book: "📖", books: "📚", journal: "📓", diary: "📓", notebook: "📔",
  paper: "📄", page: "📄", note: "📝", letter: "✉️", envelope: "✉️",
  newspaper: "📰", map: "🗺️", globe: "🌍", sign: "🪧", plaque: "🪧",
  painting: "🖼️", picture: "🖼️", poster: "🖼️", frame: "🖼️", mirror: "🪞",
  coin: "🪙", money: "💰", cash: "💵", gem: "💎", diamond: "💎",
  crown: "👑", ring: "💍", necklace: "📿",
  computer: "💻", laptop: "💻", screen: "🖥️", monitor: "🖥️",
  camera: "📷", radio: "📻", tv: "📺", battery: "🔋", plug: "🔌",
  wire: "🔌", cable: "🔌", switch: "🎛️", lever: "🎛️", keypad: "🔢",
  ladder: "🪜", stairs: "🪜", rope: "🪢", chain: "⛓️",
  bag: "👜", suitcase: "💼", briefcase: "💼", backpack: "🎒", basket: "🧺",
  drawer: "🗄️", cabinet: "🗄️", locker: "🗄️", shelf: "📚",
  skull: "💀", bone: "🦴", coffin: "⚰️", grave: "🪦",
  potion: "🧪", flask: "🧪", vial: "🧪", chemical: "🧪",
  statue: "🗿", stone: "🪨", rock: "🪨", brick: "🧱", wood: "🪵",
  window: "🪟", vent: "🕳️", hole: "🕳️", pipe: "🚰", valve: "🚰",
  ticket: "🎫", badge: "🪪", card: "🃏", dice: "🎲", puzzle: "🧩",
  broom: "🧹", bin: "🗑️", trash: "🗑️", towel: "🧻",
  fire: "🔥", water: "💧", ice: "🧊",
};

const ENTRIES = Object.entries(EMOJI);

export function searchEmoji(query, limit = 24) {
  const q = query.trim().toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ");
  if (!q) return [];
  const words = q.split(" ").filter(Boolean);

  const scored = [];
  for (const [emoji, keywords] of ENTRIES) {
    let best = null;
    for (let i = 0; i < keywords.length; i++) {
      const w = keywords[i];
      let rank = null;
      if (w === q) rank = 0;
      else if (w.split(" ").includes(q)) rank = 1;
      else if (w.startsWith(q)) rank = 2;
      else if (w.includes(q)) rank = 4;
      if (rank === null) continue;
      const score = rank * 10 + (i === 0 ? 0 : 2 + Math.min(i, 7));
      if (best === null || score < best) best = score;
    }
    if (best !== null) scored.push([best, emoji]);
  }
  scored.sort((a, b) => a[0] - b[0]);
  const ranked = scored.map((s) => s[1]);

  // PREFERRED is a single-word vocabulary, so it wins outright for one word.
  // For a phrase, a dataset entry that matched the whole thing beats the head
  // noun's pin: "magnifying glass" should find the lens, not the drinking glass.
  const pin = PREFERRED[q] || (words.length > 1 ? PREFERRED[words[words.length - 1]] : null);
  const phraseHit = words.length > 1 && scored.length > 0 && scored[0][0] < 30;
  const order = PREFERRED[q] || !phraseHit ? [pin, ...ranked] : [...ranked, pin];

  return [...new Set(order.filter(Boolean))].slice(0, limit);
}
