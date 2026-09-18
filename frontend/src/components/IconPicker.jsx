import React, { useState } from "react";

import { iconFor } from "../lib/grid";
import { searchEmoji } from "../lib/emoji";

export function IconPicker({ item, onField, disabled, suggestFor }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const term = open ? query || item.name || "" : suggestFor || "";
  const results = searchEmoji(term, open ? 48 : 10);
  const showing = open || (!!suggestFor && results.length > 0);

  const choose = (emoji) => {
    onField("icon", emoji);
    setOpen(false);
    setQuery("");
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        title={item.icon ? "Change the icon" : "Pick an icon (guessed from the name)"}
        className={`shrink-0 w-11 h-11 rounded-lg border text-2xl leading-none flex items-center justify-center disabled:opacity-40 ${
          open ? "border-emerald-500 bg-emerald-500/10" : "border-slate-700 bg-slate-950 hover:border-slate-500"
        }`}
      >
        {iconFor(item)}
      </button>

      {showing && (
        <div className="col-span-2 rounded-lg border border-slate-700 bg-slate-950 p-2">
          {open && (
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`search icons — try "${item.name || "lantern"}"`}
              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs mb-2 outline-none focus:border-emerald-500"
            />
          )}
          {results.length === 0 ? (
            <p className="text-xs text-slate-400 px-1 py-0.5">
              No icon for that word. Try a simpler one, or keep the default.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {results.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => choose(emoji)}
                  className={`w-8 h-8 rounded text-xl leading-none flex items-center justify-center hover:bg-slate-700 ${
                    item.icon === emoji ? "bg-emerald-500/20 ring-1 ring-emerald-500" : ""
                  }`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
          {item.icon && (
            <button
              type="button"
              onClick={() => choose("")}
              className="mt-2 text-xs text-slate-400 hover:text-slate-200 underline"
            >
              use the automatic icon
            </button>
          )}
        </div>
      )}
    </>
  );
}
