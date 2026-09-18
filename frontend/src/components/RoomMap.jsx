import React from "react";
import { GRID, cellPct, iconFor, norm } from "../lib/grid";

export function RoomMap({ items, lockByName, jammedByName, agentPos, agentTool, connector, effect, confetti, confettiPieces, editable, selectedIndex, onAddCell, onSelectItem, moveLimit, onMoveLimit, maxMoveLimit = 40, showAgent = true, dj = false }) {
  const toolBadge = agentTool === "search" ? "🔍" : agentTool === "hand" ? "🖐️" : agentTool === "look" ? "👀" : null;

  // Map each cell -> item index (for the tile + click behaviour).
  const itemAtCell = {};
  items.forEach((it, i) => { if (Number.isFinite(it.x)) itemAtCell[`${it.x},${it.y}`] = i; });
  const cells = [];
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) cells.push({ x, y });

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
      <div className="flex items-center justify-between mb-1 gap-2">
        <h2 className="text-sm font-semibold text-slate-100 whitespace-nowrap">🧩 Room · Puzzle Editor</h2>
        <label className="flex items-center gap-1.5 shrink-0 text-[11px] text-slate-400">
          move limit
          <input type="number" min={1} max={maxMoveLimit} value={moveLimit}
            onChange={(e) => onMoveLimit(Math.min(maxMoveLimit, Math.max(1, Number(e.target.value) || 1)))} disabled={!editable}
            className="w-14 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-xs outline-none focus:border-emerald-500 disabled:opacity-50" />
        </label>
      </div>
      <p className="text-xs text-slate-400 mb-2">{editable ? "click a + tile to add · click an item to edit" : "agent walks the room in real time"}</p>
      <div className="relative w-full aspect-square rounded-lg overflow-hidden border border-slate-700 bg-slate-950">
        {/* tile grid */}
        <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${GRID},minmax(0,1fr))`, gridTemplateRows: `repeat(${GRID},minmax(0,1fr))` }}>
          {cells.map(({ x, y }) => {
            const idx = itemAtCell[`${x},${y}`];
            const it = idx != null ? items[idx] : null;
            if (it) {
              // While editing, the padlock must reflect the item you're building
              // right now (code/key required + starts locked) — liveState only has
              // items from the last run. During a run, use the live lock state.
              const lockable = !!(it.codeRequired || it.keyRequired || it.isExit || it.isLocked);
              const locked = editable ? (lockable ? !!it.isLocked : undefined) : lockByName[norm(it.name)];
              const jammed = jammedByName?.has(norm(it.name));
              const isDoor = it.isExit || (it.name || "").toLowerCase().includes("door");
              const selected = idx === selectedIndex;
              const targeted = !!effect && effect.x === x && effect.y === y;
              return (
                <button
                  key={`${x},${y}`}
                  onClick={() => onSelectItem?.(idx)}
                  disabled={!editable}
                  title={it.name || "unnamed"}
                  className={`relative flex flex-col items-center justify-center min-w-0 overflow-hidden border border-slate-800/70 transition
                    ${selected ? "bg-emerald-500/20 ring-2 ring-emerald-500" : targeted ? "bg-sky-500/20 ring-2 ring-sky-400" : "bg-slate-800/30 hover:bg-slate-800/60"}
                    ${isDoor && locked === false ? "drop-shadow-[0_0_10px_#34d399]" : ""}`}
                >
                  <span className="text-3xl leading-none" style={isDoor ? { filter: locked === false ? "none" : "grayscale(0.25)" } : undefined}>
                    {iconFor(it)}
                  </span>
                  <span className="er-tile-label absolute inset-x-0 bottom-0.5 px-0.5 text-[10px] leading-[1.1] font-semibold text-slate-50 text-center break-words line-clamp-2">{it.name || "?"}</span>
                  {jammed
                    ? <span className="absolute top-0 right-0.5 text-[10px] leading-none" title="jammed — permanently stuck">⛔</span>
                    : locked !== undefined && <span className="absolute top-0 right-0.5 text-[10px] leading-none">{locked ? "🔒" : "🔓"}</span>}
                </button>
              );
            }
            // empty cell
            return (
              <button
                key={`${x},${y}`}
                onClick={() => editable && onAddCell?.(x, y)}
                disabled={!editable}
                className={`flex items-center justify-center border border-slate-800/40 text-slate-700 ${editable ? "hover:bg-emerald-500/10 hover:text-emerald-400" : "cursor-default"}`}
              >
                {editable && <span className="text-base leading-none">+</span>}
              </button>
            );
          })}
        </div>

        {/* connector line for "use" */}
        {connector && (
          <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ overflow: "visible" }}>
            <line
              x1={`${cellPct(connector.from.x)}%`} y1={`${cellPct(connector.from.y)}%`}
              x2={`${cellPct(connector.to.x)}%`} y2={`${cellPct(connector.to.y)}%`}
              stroke={connector.ok === false ? "#f87171" : connector.ok ? "#34d399" : "#fbbf24"}
              strokeWidth="2" strokeDasharray="5 4" className="er-dash"
            />
          </svg>
        )}

        {/* per-item effect (magnifier / sparks / pickup) */}
        {effect && (
          <span
            className="absolute -translate-x-1/2 -translate-y-full text-2xl er-pop pointer-events-none z-20"
            style={{ left: `${cellPct(effect.x)}%`, top: `${cellPct(effect.y)}%` }}
          >
            {effect.kind === "unlock" ? "✨" : effect.kind === "jam" ? "⛔" : effect.kind === "fail" ? "❌" : effect.kind === "pickup" ? "🎒" : "🔍"}
          </span>
        )}

        {/* agent */}
        {showAgent && <div
          className="absolute flex flex-col items-center -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none"
          style={{ left: `${cellPct(agentPos.x)}%`, top: `${cellPct(agentPos.y)}%`, transition: "left 1.2s ease, top 1.2s ease" }}
        >
          {dj && (
            <div className="absolute -top-5 left-1/2 w-16 h-6 -translate-x-1/2">
              <span className="absolute left-0 text-sm er-note">🎵</span>
              <span className="absolute right-0 text-sm er-note" style={{ animationDelay: "0.8s" }}>🎶</span>
            </div>
          )}
          {toolBadge && <span className="text-2xl leading-none er-bob">{toolBadge}</span>}
          <span className="relative text-4xl leading-none">
            <span className={dj ? "inline-block er-dance" : undefined}>🤖</span>
            {dj && <span className="absolute -right-4 bottom-0 text-xl er-thump">🔊</span>}
          </span>
        </div>}

        {/* confetti */}
        {confetti && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden z-30">
            {confettiPieces.map((p, i) => (
              <span key={i} className="absolute top-0 rounded-sm er-fall"
                style={{ left: `${p.left}%`, width: p.size, height: p.size, background: p.color, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s` }} />
            ))}
            <div className="absolute inset-0 flex items-center justify-center text-3xl font-bold text-emerald-300 er-pop">ESCAPED! 🎉</div>
          </div>
        )}
      </div>
    </div>
  );
}
