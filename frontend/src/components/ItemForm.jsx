import React, { useState } from "react";

import { IconPicker } from "./IconPicker";
import { Field } from "./ui";

export function ItemForm({ item, onField, disabled }) {
  const [typing, setTyping] = useState(false);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[auto_1fr] items-end gap-2">
        <IconPicker
          item={item}
          onField={onField}
          disabled={disabled}
          suggestFor={typing && !item.icon ? item.name : ""}
        />
        <Field
          label="Name"
          value={item.name}
          onChange={(v) => { setTyping(true); onField("name", v); }}
          onBlur={() => setTyping(false)}
          disabled={disabled}
          placeholder="e.g. box 1"
        />
      </div>
      <label className="block">
        <span className="text-xs text-slate-500">What the agent reads when it investigates this</span>
        <textarea value={item.description} onChange={(e) => onField("description", e.target.value)}
          placeholder={"A dusty wooden table. Taped underneath is a sticky note that reads: 'Box Code: 4829'"}
          disabled={disabled} rows={6}
          className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs mt-0.5 leading-relaxed resize-y min-h-20 disabled:opacity-50" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Code required" value={item.codeRequired} onChange={(v) => onField("codeRequired", v)} disabled={disabled} placeholder="e.g. 4829" />
        <Field label="Key required" value={item.keyRequired} onChange={(v) => onField("keyRequired", v)} disabled={disabled} placeholder="e.g. brass_key" />
        <Field label="Holds item" value={item.holdsItem} onChange={(v) => onField("holdsItem", v)} disabled={disabled} placeholder="revealed when unlocked" />
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
