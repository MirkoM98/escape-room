import React from "react";
import { Field } from "./ui";

export function ItemForm({ item, onField, disabled }) {
  return (
    <div className="space-y-2">
      <Field label="Name" value={item.name} onChange={(v) => onField("name", v)} disabled={disabled} placeholder="e.g. box 1" />
      <label className="block">
        <span className="text-xs text-slate-500">Description</span>
        <textarea value={item.description} onChange={(e) => onField("description", e.target.value)}
          placeholder="What the agent reads when it investigates this." disabled={disabled} rows={2}
          className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs mt-0.5 resize-none disabled:opacity-50" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Code required" value={item.codeRequired} onChange={(v) => onField("codeRequired", v)} disabled={disabled} placeholder="e.g. 4829" />
        <Field label="Key required" value={item.keyRequired} onChange={(v) => onField("keyRequired", v)} disabled={disabled} placeholder="e.g. brass_key" />
        <Field label="Holds item" value={item.holdsItem} onChange={(v) => onField("holdsItem", v)} disabled={disabled} placeholder="revealed when unlocked" />
        <Field label="Clue" value={item.clue} onChange={(v) => onField("clue", v)} disabled={disabled} placeholder="hidden hint" />
        <Field label="Max wrong tries" value={item.maxAttempts} onChange={(v) => onField("maxAttempts", v)} disabled={disabled} placeholder="blank = never jams" />
      </div>
      <div className="flex items-center gap-5 pt-1 text-xs text-slate-400">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={!!item.isLocked} onChange={(e) => onField("isLocked", e.target.checked)} disabled={disabled} /> starts locked
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={!!item.isExit} onChange={(e) => onField("isExit", e.target.checked)} disabled={disabled} /> is an exit (escape route)
        </label>
      </div>
    </div>
  );
}
