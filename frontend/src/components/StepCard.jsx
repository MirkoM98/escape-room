import React, { useState } from "react";
import { CopyBtn } from "./ui";

export function StepCard({ step }) {
  const [showDebug, setShowDebug] = useState(false);
  if (step.done) {
    const escaped = step.done === "escaped";
    const oom = step.done === "out_of_moves";
    const cant = step.done === "cant_solve";
    const label = escaped ? "🎉 ESCAPED" : oom ? "☠️ OUT OF MOVES" : cant ? "🤷 I CAN'T SOLVE IT" : "⏹ ENDED";
    const cls = escaped
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
      : oom || cant
      ? "border-red-500/40 bg-red-500/10 text-red-300"
      : "border-sky-500/40 bg-sky-500/10 text-sky-300";
    return (
      <div className={`rounded-lg border p-3 text-sm ${cls}`}>
        <div className="font-semibold">{label}</div>
        {step.text && <p className="mt-1 font-normal whitespace-pre-wrap">{step.text}</p>}
      </div>
    );
  }
  if (step.error) {
    return <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">⚠ {step.error}</div>;
  }
  if (step.note) {
    return <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-300">⏳ {step.note}</div>;
  }
  const a = step.action;
  const hasDebug = !!(step.llmInput || step.llmOutput);
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Iteration {step.n}</div>
      {step.thought
        ? <p className="italic text-slate-300 text-sm mb-2 whitespace-pre-wrap">💭 {step.thought}</p>
        : <p className="italic text-slate-600 text-xs mb-2">(no thinking emitted this turn)</p>}
      {a && (
        <div className="mt-1 border-l-2 border-slate-700 pl-3">
          <div className="text-sm flex items-center gap-1.5">
            <span className="text-amber-400">▸ {a.tool}</span>
            <span className="text-amber-200/70">({JSON.stringify(a.input || {})})</span>
            {a.move ? <span className="text-slate-600 text-xs"> · move {a.move}</span> : null}
            {hasDebug && (
              <button onClick={() => setShowDebug((v) => !v)}
                title="Show the exact LLM input & output for this turn"
                className={`ml-1 w-4 h-4 inline-flex items-center justify-center rounded-full border text-[10px] leading-none ${showDebug ? "border-sky-400 text-sky-300 bg-sky-500/10" : "border-slate-600 text-slate-400 hover:border-sky-400 hover:text-sky-300"}`}>
                i
              </button>
            )}
          </div>
          {hasDebug && showDebug && (
            <div className="mt-2 space-y-2 text-[10px]">
              {step.llmInput && (
                <div>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-slate-500 uppercase tracking-wide">LLM input (exact request)</span>
                    <CopyBtn text={step.llmInput} label="input" />
                  </div>
                  <pre className="h-52 min-h-16 resize-y overflow-auto bg-black/50 border border-slate-800 rounded p-2 text-sky-200/80 whitespace-pre-wrap">{step.llmInput}</pre>
                </div>
              )}
              {step.llmOutput && (
                <div>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-slate-500 uppercase tracking-wide">LLM output (raw response)</span>
                    <CopyBtn text={step.llmOutput} label="output" />
                  </div>
                  <pre className="h-40 min-h-16 resize-y overflow-auto bg-black/50 border border-slate-800 rounded p-2 text-emerald-200/80 whitespace-pre-wrap">{step.llmOutput}</pre>
                </div>
              )}
            </div>
          )}
          {step.result != null && (
            <div className={`text-sm mt-1 whitespace-pre-wrap ${resultOk(step.result) ? "text-emerald-300" : "text-red-300"}`}>
              ↳ {step.result}
            </div>
          )}
          {step.result != null && step.solved !== undefined && a?.tool !== "look_around" && (
            <StateDelta step={step} />
          )}
        </div>
      )}
    </div>
  );
}

export function resultOk(text) {
  return !/still locked|don't have|no '|nothing happens|unknown tool|jam|wrong/i.test(text || "");
}

const fmt = (v) => (v === null || v === undefined ? "—" : String(v));

const FIELD_LABELS = {
  isLocked: "locked",
  holdsItem: "holds",
  attempts: "wrong tries",
  status: "status",
};

export function StateDelta({ step }) {
  const changed = step.update?.changed || [];
  const name = step.update?.target_name;

  if (step.jammed) {
    return (
      <div className="text-[11px] mt-1 text-rose-300">
        ⛔ {name ? `${name} ` : ""}jammed permanently — it can never be opened again
      </div>
    );
  }

  if (!step.update) {
    return (
      <div className={`text-[11px] mt-1 ${step.solved ? "text-emerald-400" : "text-amber-400"}`}>
        {step.solved ? "✓ state changed" : "✗ no state change — the agent must try something else"}
      </div>
    );
  }

  if (!step.solved || !changed.length) {
    return (
      <div className="text-[11px] mt-1 text-amber-400">
        ✗ nothing changed{name ? ` on ${name}` : ""} — the agent must try something else
      </div>
    );
  }

  return (
    <div className="text-[11px] mt-1 text-emerald-400">
      <span>✓ {name ? `${name}: ` : "changed: "}</span>
      {changed.map((field, i) => (
        <span key={field}>
          {i > 0 && <span className="text-slate-500">, </span>}
          <span className="text-slate-400">{FIELD_LABELS[field] || field} </span>
          <span className="text-red-300 line-through">{fmt(step.update.before?.[field])}</span>
          <span className="text-slate-500"> → </span>
          <span className="text-emerald-300">{fmt(step.update.after?.[field])}</span>
        </span>
      ))}
    </div>
  );
}
