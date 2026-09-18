export function mergeIter(prev, iteration, patch) {
  const n = iteration || 1;
  const idx = prev.findIndex((s) => s.iter && s.n === n);
  if (idx === -1) return [...prev, { iter: true, n, ...patch }];
  return prev.map((s, i) => (i === idx ? { ...s, ...patch } : s));
}
