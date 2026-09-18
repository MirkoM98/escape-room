export async function getJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json();
}

export async function streamRun(body, onEvent, signal) {
  const res = await fetch("/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Failed to start the run (${res.status}).`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let split;
    while ((split = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6);
        if (payload === "{}") continue;
        let event;
        try {
          event = JSON.parse(payload);
        } catch {
          continue;
        }
        await onEvent(event);
      }
    }
  }
}

export function archiveRun(record) {
  return fetch("/api/history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(record),
  })
    .then((r) => (r.ok ? r.json() : { saved: false }))
    .catch(() => ({ saved: false }));
}

export function fetchHistory() {
  return getJson("/api/history").catch(() => ({ store: "none", runs: [] }));
}

export function fetchRun(num) {
  return getJson(`/api/history/${num}`).catch(() => null);
}
