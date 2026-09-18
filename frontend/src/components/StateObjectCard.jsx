import React from "react";
import { iconFor } from "../lib/grid";
import { StatusBadge } from "./ui";

export function apiJson(it) {
  const o = { id: it.id, status: it.status };
  if (it.codeRequired) o.code_required = it.codeRequired;
  if (it.keyRequired) o.key_required = it.keyRequired;
  if ("holdsItem" in it) o.holds = it.holdsItem || null;
  // Show the fragile-lock budget so the ticking counter is visible in the state panel.
  if (it.maxAttempts) o.attempts = `${it.attempts || 0}/${it.maxAttempts}`;
  if (it.isExit) o.exit = true;
  return o;
}

export function StateObjectCard({ item, update }) {
  const changed = !!update;
  return (
    <div
      // key on iteration forces a remount so the flash animation replays each change
      key={changed ? `flash-${update.iteration}` : "idle"}
      className={`rounded-lg border p-2.5 bg-slate-950/60 ${changed ? "border-emerald-500 er-flash" : "border-slate-800"}`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-semibold text-slate-100">{iconFor(item)} {item.name}</span>
        <StatusBadge status={item.status} />
      </div>
      <pre className="text-xs leading-relaxed text-emerald-200 bg-black/40 rounded p-2.5 overflow-x-auto">
{JSON.stringify(apiJson(item), null, 2)}
      </pre>
      {changed && update.changed?.length > 0 && (
        <div className="mt-2 text-xs space-y-0.5">
          {update.changed.map((f) => (
            <div key={f} className="text-slate-400">
              <span className="text-slate-300">{f}:</span>{" "}
              <span className="text-red-300 line-through">{String(update.before?.[f])}</span>{" "}
              <span className="text-slate-500">→</span>{" "}
              <span className="text-emerald-300">{String(update.after?.[f])}</span>
            </div>
          ))}
          <div className={update.solved ? "text-emerald-400" : "text-amber-400"}>
            {update.solved ? "✓ updated by this action" : "✗ unchanged"}
          </div>
        </div>
      )}
    </div>
  );
}
