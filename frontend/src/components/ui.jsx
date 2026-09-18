import React, { useState } from "react";

export function Card({ title, action, children }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export function Field({ label, value, onChange, disabled, placeholder }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500">{label}</span>
      <input value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} disabled={disabled}
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
  locked: "bg-red-500/20 text-red-300 border-red-500/40",
  unlocked: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  emptied: "bg-slate-500/20 text-slate-300 border-slate-500/40",
  escaped: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  unexamined: "bg-slate-500/20 text-slate-400 border-slate-600/40",
  examined: "bg-sky-500/20 text-sky-300 border-sky-500/40",
  jammed: "bg-rose-600/30 text-rose-200 border-rose-500/60",
};

export function StatusBadge({ status }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] border ${STATUS_STYLES[status] || STATUS_STYLES.unexamined}`}>
      {status || "—"}
    </span>
  );
}
