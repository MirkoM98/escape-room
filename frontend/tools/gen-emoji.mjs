// Regenerates src/lib/emoji-data.js from emojilib.
//   npm i -D emojilib && node tools/gen-emoji.mjs && npm un emojilib
import { readFileSync, writeFileSync } from "fs";

const lib = JSON.parse(readFileSync("node_modules/emojilib/dist/emoji-en-US.json", "utf8"));
const ZWJ = /‍/;
const SKIN = /[\u{1F3FB}-\u{1F3FF}]/u;
const FLAG = /[\u{1F1E6}-\u{1F1FF}]|\u{1F3F4}/u;

const data = {};
for (const [emoji, keywords] of Object.entries(lib)) {
  if (ZWJ.test(emoji) || SKIN.test(emoji) || FLAG.test(emoji)) continue;
  data[emoji] = [...new Set(keywords.map((w) => w.replace(/_/g, " ").toLowerCase()))].slice(0, 8);
}

writeFileSync(
  "src/lib/emoji-data.js",
  "// Generated from emojilib 4.0.3: single emoji only, no ZWJ sequences, skin\n" +
    "// tones or flags. Trimmed to 8 keywords each. Regenerate with tools/gen-emoji.mjs\n" +
    "export const EMOJI = " + JSON.stringify(data) + ";\n"
);
console.error(`wrote ${Object.keys(data).length} emoji`);
