import React, { useState } from "react";

export function Card({ title, action, children }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <h2 className="text-[15px] font-semibold text-slate-100">{title}</h2>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export function Field({ label, value, onChange, onBlur, disabled, placeholder }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-400">{label}</span>
      <input value={value || ""} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} placeholder={placeholder} disabled={disabled}
        className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs mt-0.5 disabled:opacity-50" />
    </label>
  );
}

export function CopyBtn({ text, label }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text || "");
    } catch {
      // fallback for non-secure contexts
      const ta = document.createElement("textarea");
      ta.value = text || ""; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch { /* ignore */ }
      document.body.removeChild(ta);
    }
    setCopied(true); setTimeout(() => setCopied(false), 1200);
  };
  return (
    <button onClick={copy}
      className="text-[10px] px-1.5 py-0.5 rounded border border-slate-700 text-slate-400 hover:text-sky-300 hover:border-sky-400">
      {copied ? "✓ copied" : `⧉ copy${label ? " " + label : ""}`}
    </button>
  );
}

const STATUS_STYLES = {
  unexamined: "bg-slate-700/40 text-slate-400 border-slate-600",
  examined: "bg-sky-500/15 text-sky-300 border-sky-500/50",
  locked: "bg-rose-500/15 text-rose-300 border-rose-500/50",
  unlocked: "bg-emerald-500/15 text-emerald-300 border-emerald-500/50",
  emptied: "bg-teal-500/10 text-teal-300/90 border-teal-600/40",
  escaped: "bg-emerald-500/25 text-emerald-200 border-emerald-400 ring-1 ring-emerald-400/40",
  jammed: "bg-rose-600/30 text-rose-200 border-rose-400 ring-1 ring-rose-400/40",
};

export function StatusBadge({ status }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${STATUS_STYLES[status] || STATUS_STYLES.unexamined}`}>
      {status || "—"}
    </span>
  );
}
