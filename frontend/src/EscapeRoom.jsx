import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Escape Room — Agentic Loop dashboard.
 *
 * Left  = inputs (agent's tools, settings, puzzle editor with X/Y, live state).
 * Right = a 2D map where the agent (🤖) walks to items and acts in real time,
 *         plus a step-by-step execution trace (thought → action → result).
 *
 * The Anthropic loop + tool execution live in the Python backend and stream
 * events over SSE. The frontend buffers those events in a queue and plays them
 * back with animation pacing, so nothing blocks the backend's API threads.
 */

const GRID = 5;
const AGENT_START = { x: 2, y: 4 };

// The exact tools the agent can call each turn (mirrors backend/skill.py).
const AGENT_ACTIONS = [
  { icon: "👁️", name: "look_around()", desc: "Survey the room — lists every visible item and whether it's locked." },
  { icon: "🔍", name: "investigate_item(name)", desc: "Read an item's description + clue. If it holds something and is unlocked, the agent takes it." },
  { icon: "🖐️", name: "use_item_on_target(item, target)", desc: "Enter a code, or use a key from inventory, to unlock a target." },
  { icon: "🚪", name: "escape()", desc: "Try to leave. Works only once the exit door is unlocked." },
];

const CANDIDATE_CELLS = [
  [2, 0], [1, 2], [3, 2], [0, 1], [4, 1], [2, 2], [0, 3], [4, 3], [1, 0], [3, 0], [2, 3], [0, 0],
];

const EMPTY_ITEM = () => ({
  id: "", name: "", description: "", isVisible: true, isLocked: false,
  codeRequired: "", keyRequired: "", holdsItem: "", clue: "", isExit: false,
  maxAttempts: "", x: undefined, y: undefined,
});

const norm = (s) => String(s || "").trim().toLowerCase().replace(/[_\s]/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cellPct = (v) => ((v + 0.5) / GRID) * 100;

function iconFor(item) {
  const n = (item.name || "").toLowerCase();
  // Name wins over isExit, so an exit that is a vent/hatch keeps its own look
  // instead of turning into a door.
  if (n.includes("vent") || n.includes("duct") || n.includes("shaft") || n.includes("grate")) return "🕳️";
  if (n.includes("window")) return "🪟";
  if (n.includes("door") || n.includes("exit") || n.includes("hatch") || n.includes("gate")) return "🚪";
  if (n.includes("chest") || n.includes("box") || n.includes("crate")) return "📦";
  if (n.includes("table") || n.includes("desk")) return "🪑";
  if (n.includes("wall") || n.includes("brick")) return "🧱";
  if (n.includes("drawer") || n.includes("cabinet")) return "🗄️";
  if (n.includes("paint") || n.includes("picture") || n.includes("frame")) return "🖼️";
  if (n.includes("safe") || n.includes("vault")) return "🔐";
  if (n.includes("key")) return "🗝️";
  if (n.includes("plant") || n.includes("pot")) return "🪴";
  if (n.includes("rug") || n.includes("carpet")) return "🧶";
  if (n.includes("book") || n.includes("shelf")) return "📚";
  if (n.includes("clock")) return "🕰️";
  if (n.includes("lamp") || n.includes("light")) return "💡";
  if (item.isExit) return "🚪";   // an exit with an unrecognized name still reads as a way out
  return "📦";
}

// Give every item a grid cell, keeping any coords the user already set.
function assignPositions(list) {
  const used = new Set();
  list.forEach((it) => {
    if (Number.isFinite(it.x) && Number.isFinite(it.y)) used.add(`${it.x},${it.y}`);
  });
  let ci = 0;
  return list.map((it) => {
    if (Number.isFinite(it.x) && Number.isFinite(it.y)) return it;
    let cell;
    if (it.isExit) {
      cell = [Math.floor(GRID / 2), 0];
    } else {
      while (ci < CANDIDATE_CELLS.length && used.has(CANDIDATE_CELLS[ci].join(","))) ci++;
      cell = CANDIDATE_CELLS[ci] || [ci % GRID, Math.min(GRID - 1, 2 + Math.floor(ci / GRID))];
      ci++;
    }
    used.add(cell.join(","));
    return { ...it, x: cell[0], y: cell[1] };
  });
}

function freeCell(list) {
  const used = new Set(list.map((it) => `${it.x},${it.y}`));
  for (const [x, y] of CANDIDATE_CELLS) if (!used.has(`${x},${y}`)) return { x, y };
  for (let y = 1; y < GRID; y++) for (let x = 0; x < GRID; x++) if (!used.has(`${x},${y}`)) return { x, y };
  return { x: 4, y: 4 };
}

// Strip empty optional fields into a clean room definition for the backend.
function cleanItem(raw, index) {
  const id = (raw.id && raw.id.trim()) ||
    (raw.name || `item_${index + 1}`).trim().toLowerCase().replace(/\s+/g, "_");
  const item = { id, name: (raw.name || id).trim(), isVisible: raw.isVisible !== false };
  if (raw.description?.trim()) item.description = raw.description.trim();
  if (raw.clue?.trim()) item.clue = raw.clue.trim();
  if (raw.codeRequired?.toString().trim()) item.codeRequired = raw.codeRequired.toString().trim();
  if (raw.keyRequired?.trim()) item.keyRequired = raw.keyRequired.trim();
  if (raw.holdsItem?.trim()) item.holdsItem = raw.holdsItem.trim();
  // Fragile lock: after this many WRONG attempts the object jams permanently.
  // Only meaningful on a lockable object; 0/blank means "never jams".
  const maxTries = parseInt(raw.maxAttempts, 10);
  if (Number.isFinite(maxTries) && maxTries > 0) item.maxAttempts = maxTries;
  if (raw.isExit) item.isExit = true;
  if (Number.isFinite(raw.x)) item.x = raw.x;
  if (Number.isFinite(raw.y)) item.y = raw.y;
  // The "starts locked" checkbox is the source of truth. (Entering a code/key
  // auto-checks it in the editor, but the user can uncheck it.) A container that
  // merely holds an item is NOT a lock — it gets no isLocked field, so the map
  // shows no padlock on it unless it is genuinely locked.
  if (item.codeRequired || item.keyRequired || raw.isExit || raw.isLocked) {
    item.isLocked = !!raw.isLocked;
  }
  return item;
}

export default function EscapeRoom() {
  const [moveLimit, setMoveLimit] = useState(() => Number(localStorage.getItem("er_move_limit")) || 15);
  const [provider, setProvider] = useState(() => localStorage.getItem("er_provider") || "auto");
  // Resizable split: width of the LEFT column (percent); the right column flexes.
  const [leftWidth, setLeftWidth] = useState(() => Number(localStorage.getItem("er_left_w")) || 40);
  const [isWide, setIsWide] = useState(true);
  const [leftCollapsed, setLeftCollapsed] = useState(() => localStorage.getItem("er_left_collapsed") === "1");
  const [loop, setLoop] = useState(() => localStorage.getItem("er_loop") === "1");
  const [items, setItems] = useState([]);
  const [liveState, setLiveState] = useState({ items: [], inventory: [], escaped: false });
  const [steps, setSteps] = useState([]);
  const [status, setStatus] = useState("Idle");
  const [moves, setMoves] = useState({ used: 0, limit: 15 });
  const [error, setError] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null); // {target, before, after, changed, solved, iteration}
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [roomName, setRoomName] = useState("Custom room");
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  // Presets (built-ins + user rooms) all live on the backend now, so edits are
  // permanent. Each carries `custom` and `edited` flags from the server.
  const [presets, setPresets] = useState([]);
  const [editingId, setEditingId] = useState(null);

  // Animation state for the map.
  const [agentPos, setAgentPos] = useState(AGENT_START);
  const [agentTool, setAgentTool] = useState(null);   // "search" | "hand" | "look" | null
  const [connector, setConnector] = useState(null);   // {from,to,ok}
  const [effect, setEffect] = useState(null);          // {x,y,kind}
  const [confetti, setConfetti] = useState(false);

  const esRef = useRef(null);
  const sessionRef = useRef(null);
  const traceRef = useRef(null);
  const atBottomRef = useRef(true);
  const itemsRef = useRef([]);
  const stepsRef = useRef([]);
  const roomNameRef = useRef("Custom room");
  const agentPosRef = useRef(AGENT_START);
  const queueRef = useRef([]);
  const drainingRef = useRef(false);
  const runIdRef = useRef(0);
  const loopRef = useRef(loop);
  const loopTimerRef = useRef(null);
  const splitRef = useRef(null);
  const leftWidthRef = useRef(leftWidth);

  const isRunning = status === "Running...";

  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => { agentPosRef.current = agentPos; }, [agentPos]);
  useEffect(() => { stepsRef.current = steps; }, [steps]);
  useEffect(() => { leftWidthRef.current = leftWidth; }, [leftWidth]);

  // Only allow the horizontal split on wide screens; stack on small ones.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const on = () => setIsWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // Drag the divider: recompute the left column's width from the cursor's X.
  const startDrag = (e) => {
    e.preventDefault();
    const move = (ev) => {
      const el = splitRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const pct = Math.max(22, Math.min(72, ((ev.clientX - rect.left) / rect.width) * 100));
      setLeftWidth(pct);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      localStorage.setItem("er_left_w", String(Math.round(leftWidthRef.current)));
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  useEffect(() => { roomNameRef.current = roomName; }, [roomName]);
  useEffect(() => { loopRef.current = loop; }, [loop]);

  const confettiPieces = useMemo(
    () => Array.from({ length: 44 }).map((_, i) => ({
      left: Math.random() * 100,
      delay: Math.random() * 0.6,
      dur: 1.4 + Math.random() * 1.2,
      color: ["#34d399", "#fbbf24", "#60a5fa", "#f472b6", "#a78bfa"][i % 5],
      size: 6 + Math.random() * 6,
    })),
    []
  );

  // Seed editor + map from the backend's default puzzle.
  useEffect(() => {
    fetch("/api/default-room")
      .then((r) => r.json())
      .then((data) => {
        const room = data.room || { items: [], inventory: [] };
        const seeded = assignPositions(room.items.map((it) => ({ ...EMPTY_ITEM(), ...it })));
        setItems(seeded);
        setLiveState({ items: seeded, inventory: room.inventory || [], escaped: false });
      })
      .catch(() => setError("Could not reach the backend at /api. Is the server running on :8000?"));
    refreshPresets();
    return () => { esRef.current?.close(); clearTimeout(loopTimerRef.current); };
  }, []);

  // Loop mode: after a run finishes, automatically start the next one.
  const toggleLoop = () => {
    const next = !loop;
    setLoop(next);
    loopRef.current = next;
    localStorage.setItem("er_loop", next ? "1" : "0");
    if (next && !isRunning) start();
    if (!next) { clearTimeout(loopTimerRef.current); loopTimerRef.current = null; }
  };

  const refreshPresets = () =>
    fetch("/api/presets")
      .then((r) => r.json())
      .then((data) => { setPresets(data.presets || []); return data.presets || []; })
      .catch(() => []);

  const loadPreset = (room, name) => {
    reset(false);
    const seeded = assignPositions(room.items.map((it) => ({ ...EMPTY_ITEM(), ...it })));
    setItems(seeded);
    setLiveState({ items: seeded.map(cleanItem), inventory: [], escaped: false });
    setSelectedIndex(null);
    if (name) setRoomName(name);
  };

  // Persist a finished run to escaping-history.json (via the backend).
  const saveRun = (finalSteps, reason, finalState) => {
    const outcome =
      reason === "escaped" ? "Escaped"
      : reason === "out_of_moves" ? "Out of moves"
      : reason === "cant_solve" ? "Stuck"
      : "Ended";
    fetch("/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        room_name: roomNameRef.current,
        outcome,
        room: { items: itemsRef.current.map(cleanItem), inventory: [] },
        steps: finalSteps,
        state: finalState || null,
      }),
    }).catch(() => {});
  };

  const openHistory = () => {
    fetch("/api/history")
      .then((r) => r.json())
      .then((data) => setHistory(data.runs || []))
      .catch(() => setHistory([]));
    setShowHistory(true);
  };

  const clearHistory = async () => {
    if (!window.confirm("Delete ALL escaping history? This cannot be undone.")) return;
    await fetch("/api/history", { method: "DELETE" }).catch(() => {});
    setHistory([]);
  };

  // Load a past run: reload its room and replay its finished execution trace.
  const loadHistoryEntry = (num) => {
    fetch(`/api/history/${num}`)
      .then((r) => r.json())
      .then((entry) => {
        runIdRef.current++;
        esRef.current?.close();
        queueRef.current = [];
        drainingRef.current = false;
        const seeded = assignPositions((entry.room.items || []).map((it) => ({ ...EMPTY_ITEM(), ...it })));
        setItems(seeded);
        setLiveState(entry.state || { items: seeded.map(cleanItem), inventory: [], escaped: false });
        setSteps(entry.steps || []);
        setLastUpdate(null);
        setSelectedIndex(null);
        setRoomName(entry.room_name || "Room");
        setStatus(
          entry.outcome === "Escaped" ? "ESCAPED! 🎉"
          : entry.outcome === "Stuck" ? "CAN'T SOLVE 🤷"
          : entry.outcome === "Out of moves" ? "OUT OF MOVES ☠️"
          : "Ended"
        );
        setShowHistory(false);
      })
      .catch(() => {});
  };

  const saveCurrentAsPreset = async () => {
    const name = window.prompt("Name this preset:", "My room");
    if (!name || !name.trim()) return;
    await fetch("/api/presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        description: "Your saved room",
        room: { items: items.map(cleanItem), inventory: [] },
      }),
    }).catch(() => {});
    await refreshPresets();
  };

  const deleteCustomPreset = async (id) => {
    await fetch(`/api/presets/${id}`, { method: "DELETE" }).catch(() => {});
    if (editingId === id) setEditingId(null);
    await refreshPresets();
  };

  // --- editing preset rooms -------------------------------------------------

  // Load a preset into the grid AND enter edit mode for it (name/identity kept).
  const editPreset = (p) => {
    loadPreset(p.room, p.name);
    setEditingId(p.id);
  };

  // Persist the current grid back to the preset being edited (server-side file).
  const saveEdits = async () => {
    if (!editingId) return;
    const room = { items: items.map(cleanItem), inventory: [] };
    await fetch(`/api/presets/${editingId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room }),
    }).catch(() => {});
    await refreshPresets();
    setLiveState({ items: room.items, inventory: [], escaped: false });
    setEditingId(null);
  };

  // Discard unsaved edits: reload the preset's last-saved room.
  const cancelEdit = () => {
    const p = allPresets.find((x) => x.id === editingId);
    setEditingId(null);
    if (p) loadPreset(p.room, p.name);
  };

  // Drop a built-in preset's override, restoring the original room.
  const revertPreset = async (id) => {
    await fetch(`/api/presets/${id}`, { method: "DELETE" }).catch(() => {});
    if (editingId === id) setEditingId(null);
    const fresh = await refreshPresets();
    const base = fresh.find((p) => p.id === id);
    if (base && base.name === roomName) loadPreset(base.room, base.name);
  };

  const allPresets = presets;
  // The preset currently loaded (matched by name); null when the grid is a
  // custom/unsaved room. Drives the dropdown value and the per-room actions.
  const selectedPreset = allPresets.find((p) => p.name === roomName) || null;

  // Auto-scroll the trace ONLY if the user is already at the bottom.
  useEffect(() => {
    const el = traceRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [steps]);

  const onTraceScroll = () => {
    const el = traceRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottomRef.current = dist < 40;
    setShowScrollBtn(dist >= 40);
  };

  const scrollTraceToBottom = () => {
    const el = traceRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    atBottomRef.current = true;
    setShowScrollBtn(false);
  };

  // --- puzzle editor helpers ------------------------------------------------

  // Any manual edit means the room no longer matches a preset — UNLESS we are
  // deliberately editing that preset (then we keep its identity until saved).
  const markCustom = () => { if (!editingId) setRoomName("Custom room"); };

  const updateItem = (index, field, value) => {
    markCustom();
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== index) return it;
        const next = { ...it, [field]: value };
        // Keep "starts locked" in sync with the presence of a code/key:
        // entering one locks the item; clearing the last one unlocks it (so the
        // padlock disappears). The exit door stays lockable regardless.
        if (field === "codeRequired" || field === "keyRequired") {
          const hasLock = !!(next.codeRequired || next.keyRequired);
          if (hasLock && !it.isLocked) next.isLocked = true;
          else if (!hasLock && !next.isExit && it.isLocked) next.isLocked = false;
        }
        return next;
      })
    );
  };

  // Add an item at a specific grid cell (clicked on the map) and select it.
  const addItemAt = (x, y) => {
    markCustom();
    setItems((prev) => {
      const next = [...prev, { ...EMPTY_ITEM(), x, y }];
      setSelectedIndex(next.length - 1);
      return next;
    });
  };
  const addItem = () => {
    markCustom();
    setItems((prev) => {
      const next = [...prev, { ...EMPTY_ITEM(), ...freeCell(prev) }];
      setSelectedIndex(next.length - 1);
      return next;
    });
  };
  const removeItem = (index) => {
    markCustom();
    setItems((prev) => prev.filter((_, i) => i !== index));
    setSelectedIndex(null);
  };


  // --- lock lookup for the map ---------------------------------------------

  const jammedByName = useMemo(() => {
    const s = new Set();
    liveState.items.forEach((it) => { if (it.status === "jammed") s.add(norm(it.name)); });
    return s;
  }, [liveState]);

  const lockByName = useMemo(() => {
    const m = {};
    liveState.items.forEach((it) => { if ("isLocked" in it) m[norm(it.name)] = it.isLocked; });
    return m;
  }, [liveState]);

  const currentStep = useMemo(() => steps.reduce((m, s) => (s.iter ? Math.max(m, s.n) : m), 0), [steps]);

  const coordsFor = (nameRef) => {
    const it = itemsRef.current.find((x) => norm(x.name) === norm(nameRef));
    return it && Number.isFinite(it.x) ? { x: it.x, y: it.y } : null;
  };
  const doorCoords = () => {
    const d = itemsRef.current.find((x) => x.isExit || norm(x.name).includes("door"));
    return d ? { x: d.x, y: d.y } : { x: Math.floor(GRID / 2), y: 0 };
  };

  // --- SSE + animated event queue ------------------------------------------

  const start = async () => {
    reset(true);
    setStatus("Running...");
    localStorage.setItem("er_move_limit", String(moveLimit));
    localStorage.setItem("er_provider", provider);
    const myRun = ++runIdRef.current;

    try {
      const room = { items: items.map(cleanItem), inventory: [] };
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room, move_limit: moveLimit, provider }),
      });
      if (!res.ok) throw new Error(`Failed to create session (${res.status}).`);
      const data = await res.json();
      sessionRef.current = data.session_id;
      setLiveState(data.state);

      const es = new EventSource(`/api/session/${data.session_id}/run`);
      esRef.current = es;
      es.onmessage = (ev) => {
        if (runIdRef.current !== myRun) return;
        try {
          queueRef.current.push(JSON.parse(ev.data));
          drain(myRun);
        } catch { /* ignore keep-alives */ }
      };
      es.addEventListener("end", () => es.close());
      es.onerror = () => {
        es.close();
        if (runIdRef.current === myRun && drainingRef.current === false && queueRef.current.length === 0) {
          setStatus((s) => (["ESCAPED! 🎉", "OUT OF MOVES ☠️", "Ended"].includes(s) ? s : "Error"));
        }
      };
    } catch (err) {
      setStatus("Error");
      setError(err.message);
    }
  };

  const drain = async (myRun) => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    while (queueRef.current.length && runIdRef.current === myRun) {
      const ev = queueRef.current.shift();
      await handleEvent(ev, myRun);
    }
    drainingRef.current = false;
  };

  const handleEvent = async (event, myRun) => {
    const alive = () => runIdRef.current === myRun;
    if (event.state) setLiveState(event.state);
    if (event.move) setMoves({ used: event.move, limit: event.move_limit || moveLimit });

    switch (event.type) {
      case "thinking":
        setSteps((prev) => mergeIter(prev, event.iteration, { thought: event.text }));
        await sleep(500);
        break;

      case "action": {
        setSteps((prev) => mergeIter(prev, event.iteration, { action: { tool: event.tool, input: event.input, move: event.move }, llmInput: event.llm_input, llmOutput: event.llm_output }));
        const tool = event.tool;
        if (tool === "look_around") {
          setAgentTool("look");
          await sleep(900);
        } else if (tool === "escape") {
          const d = doorCoords();
          setAgentTool("hand");
          setAgentPos(d);
          await sleep(1300);
        } else {
          const targetName = event.input?.item_name || event.input?.target_object;
          const c = coordsFor(targetName);
          setAgentTool(tool === "investigate_item" ? "search" : "hand");
          if (c) {
            if (tool === "use_item_on_target") {
              setConnector({ from: agentPosRef.current, to: c, ok: null });
            }
            // stand just below the target so it's not covered
            setAgentPos({ x: c.x, y: Math.min(GRID - 1, c.y + 1) });
          }
          await sleep(1400);
        }
        break;
      }

      case "result": {
        setSteps((prev) => mergeIter(prev, event.iteration, { result: event.text, solved: event.update?.solved }));
        if (event.update?.target) setLastUpdate({ ...event.update, iteration: event.iteration });
        const success = !/still locked|don't have|no '|nothing happens|unknown tool/i.test(event.text);
        const targetName = event.input?.target_object || event.input?.item_name;
        const c = coordsFor(targetName) || agentPosRef.current;
        if (event.tool === "use_item_on_target") {
          setConnector((k) => (k ? { ...k, ok: success } : null));
          setEffect({ x: c.x, y: c.y, kind: success ? "unlock" : "fail" });
        } else if (event.tool === "investigate_item") {
          setEffect({ x: c.x, y: c.y, kind: /found a .*inside/i.test(event.text) ? "pickup" : "search" });
        }
        await sleep(900);
        if (!alive()) break;
        setAgentTool(null);
        setConnector(null);
        setEffect(null);
        break;
      }

      case "done":
        if (event.reason === "escaped") {
          const d = doorCoords();
          setAgentPos(d);
          setAgentTool(null);
          await sleep(1000);
          if (!alive()) break;
          setAgentPos({ x: d.x, y: -1.3 }); // walk off the top wall
          setConfetti(true);
          await sleep(600);
          setStatus("ESCAPED! 🎉");
        } else if (event.reason === "out_of_moves") {
          setStatus("OUT OF MOVES ☠️");
        } else if (event.reason === "cant_solve") {
          setStatus("CAN'T SOLVE 🤷");
        } else {
          setStatus("Ended");
        }
        setSteps((prev) => [...prev, { done: event.reason, text: event.text }]);
        // Log this finished run to history (room + full trace + outcome).
        saveRun([...stepsRef.current, { done: event.reason, text: event.text }], event.reason, event.state);
        // Loop mode: chain into the next run once the animations settle.
        if (loopRef.current && alive()) {
          clearTimeout(loopTimerRef.current);
          loopTimerRef.current = setTimeout(() => { if (loopRef.current) start(); }, 1800);
        }
        break;

      case "error":
        setError(event.text);
        setStatus("Error");
        setSteps((prev) => [...prev, { error: event.text }]);
        break;

      case "status":
        // Show ret/overload notes, and the per-move "CLI is thinking…" waits so
        // the slow CLI provider (~5-7s/move) visibly shows activity, not a freeze.
        if (event.cli_wait) {
          setStatus("Thinking… (CLI)");
          setSteps((prev) => {
            // keep just one live "thinking…" note (replace the previous one)
            const trimmed = prev.length && prev[prev.length - 1].note?.startsWith("Claude (CLI)")
              ? prev.slice(0, -1) : prev;
            return [...trimmed, { note: event.text }];
          });
        } else if (event.text && /retry|overload|switching|falling back|using the local/i.test(event.text)) {
          setSteps((prev) => [...prev, { note: event.text }]);
        }
        break;

      default:
        break;
    }
  };

  const reset = (keepConfigOnly) => {
    runIdRef.current++;
    esRef.current?.close();
    queueRef.current = [];
    drainingRef.current = false;
    // Cancel any pending loop restart (start() calls reset(true), which is fine
    // because start reschedules only after the next run finishes).
    if (!keepConfigOnly) clearTimeout(loopTimerRef.current);
    if (sessionRef.current) {
      fetch(`/api/session/${sessionRef.current}`, { method: "DELETE" }).catch(() => {});
      sessionRef.current = null;
    }
    setSteps([]);
    setError("");
    setLastUpdate(null);
    setEditingId(null);
    setMoves({ used: 0, limit: moveLimit });
    setAgentPos(AGENT_START);
    setAgentTool(null);
    setConnector(null);
    setEffect(null);
    setConfetti(false);
    if (!keepConfigOnly) {
      setStatus("Idle");
      setLiveState({ items: items.map(cleanItem), inventory: [], escaped: false });
      setRoomName("Custom room");
    }
  };

  const statusStyle = useMemo(() => {
    switch (status) {
      case "Running...": return "bg-amber-500/20 text-amber-300 border-amber-500/40";
      case "ESCAPED! 🎉": return "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";
      case "OUT OF MOVES ☠️":
      case "CAN'T SOLVE 🤷":
      case "Error": return "bg-red-500/20 text-red-300 border-red-500/40";
      case "Ended": return "bg-sky-500/20 text-sky-300 border-sky-500/40";
      default: return "bg-slate-500/20 text-slate-300 border-slate-500/40";
    }
  }, [status]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-mono">
      <style>{KEYFRAMES}</style>

      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            🔐 Escape Room — <span className="text-emerald-400">Agentic Loop</span>
          </h1>
          <p className="text-xs text-slate-500">
            An autonomous Claude agent is locked into a room with objects, clues, and a single exit. Watch him try to escape your custom rooms.
          </p>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs border ${statusStyle}`}>{status}</span>
      </header>

      {error && (
        <div className="mx-6 mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">{error}</div>
      )}

      <main ref={splitRef} className="flex flex-col lg:flex-row gap-6 lg:gap-0 p-6">
        {/* LEFT: actions (collapsible) + item editor + world state — resizable width */}
        <section className="w-full space-y-6" style={isWide ? (leftCollapsed ? { display: "none" } : { width: `${leftWidth}%` }) : undefined}>
          <div className="rounded-xl border border-slate-800 bg-slate-900/40">
            <details>
              <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-slate-200">
                🤖 Agent's Actions — its only 4 tools <span className="text-slate-500 font-normal">(click to expand)</span>
              </summary>
              <div className="px-4 pb-4 space-y-2">
                {AGENT_ACTIONS.map((a) => (
                  <div key={a.name} className="flex gap-3 rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
                    <span className="text-lg leading-none">{a.icon}</span>
                    <div>
                      <code className="text-emerald-400 text-xs">{a.name}</code>
                      <p className="text-xs text-slate-400 mt-0.5">{a.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          </div>

          <Card
            title={selectedIndex != null && items[selectedIndex] ? `✏️ Editing item @ cell (${items[selectedIndex].x},${items[selectedIndex].y})` : "✏️ Item Editor"}
            action={selectedIndex != null && items[selectedIndex] ? (
              <button onClick={() => removeItem(selectedIndex)} disabled={isRunning}
                className="text-red-400 hover:text-red-300 text-xs px-2 disabled:opacity-40" title="Remove item">✕ remove</button>
            ) : null}
          >
            {selectedIndex != null && items[selectedIndex] ? (
              <ItemForm item={items[selectedIndex]} disabled={isRunning}
                onField={(field, value) => updateItem(selectedIndex, field, value)} />
            ) : (
              <p className="text-xs text-slate-500 leading-relaxed">
                Click a <span className="text-emerald-400 font-bold">+</span> tile on the room grid to add an item, or click an
                existing item to edit it here. Build a chain: a clue points to a code/key → that opens a container → the
                container holds the next key → until the exit door opens.
              </p>
            )}
          </Card>

          {/* World State — moved under the Item Editor (left column) */}
          <Card title="🗃️ World State (JSON) — updates object-by-object each iteration">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {liveState.items.map((it) => (
                <StateObjectCard key={it.id} item={it} update={lastUpdate?.target === it.id ? lastUpdate : null} />
              ))}
            </div>
          </Card>
        </section>

        {isWide && (
          <div className="hidden lg:block relative shrink-0 mx-1" style={{ width: leftCollapsed ? 14 : 16 }}>
            {!leftCollapsed && (
              <div onMouseDown={startDrag} title="Drag to resize — shrink the left, grow the trace"
                className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-1 rounded bg-slate-700 hover:bg-emerald-500 transition-colors cursor-col-resize" />
            )}
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setLeftCollapsed((c) => { const n = !c; localStorage.setItem("er_left_collapsed", n ? "1" : "0"); return n; })}
              title={leftCollapsed ? "Show the left panel" : "Collapse the left panel — show only the room"}
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 w-5 h-9 flex items-center justify-center rounded bg-slate-800 border border-slate-600 text-slate-300 hover:bg-emerald-600 hover:text-white hover:border-emerald-500 text-[11px] leading-none shadow">
              {leftCollapsed ? "▶" : "◀"}
            </button>
          </div>
        )}

        {/* RIGHT: grid + live state + trace — flexes to fill remaining space */}
        <section className="w-full lg:flex-1 lg:min-w-0 space-y-4">
          {/* Presets — a single dropdown selector + per-room actions */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-slate-300 shrink-0">🎬 Room</span>
              <select
                value={selectedPreset?.id || ""}
                onChange={(e) => { const p = allPresets.find((x) => x.id === e.target.value); if (p) loadPreset(p.room, p.name); }}
                disabled={isRunning}
                className="min-w-[240px] bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-100 disabled:opacity-50">
                {!selectedPreset && <option value="">Custom room (unsaved)</option>}
                <optgroup label="Built-in rooms">
                  {allPresets.filter((p) => !p.custom).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}{p.edited ? "  ✎" : ""}</option>
                  ))}
                </optgroup>
                {allPresets.some((p) => p.custom) && (
                  <optgroup label="Your saved rooms">
                    {allPresets.filter((p) => p.custom).map((p) => (
                      <option key={p.id} value={p.id}>⭐ {p.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>

              {/* Actions for the selected room (edit / delete custom / revert built-in) */}
              {selectedPreset && editingId !== selectedPreset.id && (
                <button onClick={() => editPreset(selectedPreset)} disabled={isRunning} title="Load this room onto the grid to edit it"
                  className="text-xs px-2.5 py-1.5 rounded border border-slate-700 bg-slate-800/60 text-sky-300 hover:bg-slate-700 disabled:opacity-40">✏️ Edit</button>
              )}
              {selectedPreset?.custom && (
                <button onClick={() => deleteCustomPreset(selectedPreset.id)} disabled={isRunning} title="Delete this saved room"
                  className="text-xs px-2.5 py-1.5 rounded border border-slate-700 bg-slate-800/60 text-red-400 hover:bg-slate-700 disabled:opacity-40">🗑 Delete</button>
              )}
              {selectedPreset?.edited && !selectedPreset?.custom && (
                <button onClick={() => revertPreset(selectedPreset.id)} disabled={isRunning} title="Revert this built-in room to its original"
                  className="text-xs px-2.5 py-1.5 rounded border border-slate-700 bg-slate-800/60 text-amber-300 hover:bg-slate-700 disabled:opacity-40">↺ Revert</button>
              )}

              <div className="ml-auto flex items-center gap-2 shrink-0">
                <button onClick={openHistory}
                  className="text-xs px-3 py-1.5 rounded border border-slate-700 bg-slate-800/60 hover:bg-slate-700">🕘 History</button>
                <button onClick={saveCurrentAsPreset} disabled={isRunning || items.length === 0}
                  className="text-xs px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40">💾 Save as preset</button>
              </div>
            </div>

            {/* Short description of the selected room, so you know what it tests */}
            {selectedPreset?.description && !editingId && (
              <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">{selectedPreset.description}</p>
            )}

            {editingId && (
              <div className="mt-2 flex items-center justify-between gap-2 rounded border border-sky-500/40 bg-sky-500/10 px-3 py-2">
                <span className="text-xs text-sky-200">✏️ Editing: <b>{roomName}</b> — change items on the grid, then save.</span>
                <div className="flex gap-2 shrink-0">
                  <button onClick={saveEdits} disabled={isRunning}
                    className="text-xs px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40">💾 Save changes</button>
                  <button onClick={cancelEdit} disabled={isRunning}
                    className="text-xs px-3 py-1 rounded border border-slate-600 hover:bg-slate-700 disabled:opacity-40">✕ Cancel</button>
                </div>
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={start} disabled={isRunning || items.length === 0}
              className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold disabled:opacity-40">▶ Start Escaping</button>
            <button onClick={() => reset(false)} className="px-4 py-2 rounded bg-red-600 hover:bg-red-500 text-sm font-semibold">↺ Reset Game</button>
            <button onClick={toggleLoop} title="Keep starting a new run automatically after each one finishes"
              className={`px-4 py-2 rounded text-sm font-semibold border ${loop ? "bg-sky-600 hover:bg-sky-500 border-sky-400 text-white" : "bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-300"}`}>
              🔁 Loop{loop ? " ON" : " OFF"}
            </button>
            <label className="flex items-center gap-1.5 text-xs text-slate-400"
              title="How the backend reaches Claude: auto (API key, else CLI) · api (needs ANTHROPIC_API_KEY) · cli (local Claude Code login, no key)">
              <span>Claude via</span>
              <select value={provider} onChange={(e) => setProvider(e.target.value)} disabled={isRunning}
                className="bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200 disabled:opacity-50">
                <option value="auto">auto (key → CLI)</option>
                <option value="api">api (token)</option>
                <option value="cli">cli (local login)</option>
              </select>
              {provider === "cli" && <span className="text-[10px] text-amber-400" title="Each move spawns a fresh `claude -p` process">~7s/move</span>}
            </label>
            <div className="ml-auto flex items-center gap-4 text-xs">
              {loop && <span className="text-sky-400 animate-pulse">looping…</span>}
              {isRunning && <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />}
              <span className="text-slate-300">iteration: <span className="text-sky-400">{currentStep}</span></span>
              <span className="text-slate-300">moves: <span className="text-emerald-400">{moves.used}</span> / {moves.limit}</span>
            </div>
          </div>

          {/* Room grid — doubles as the puzzle editor (idle) and the map (running) */}
          <div className="flex flex-col xl:flex-row gap-4 items-start">
            <div className="w-full xl:w-[360px] shrink-0 space-y-4">
              <RoomMap
                items={items}
                lockByName={lockByName}
                jammedByName={jammedByName}
                agentPos={agentPos}
                agentTool={agentTool}
                connector={connector}
                effect={effect}
                confetti={confetti}
                confettiPieces={confettiPieces}
                editable={!isRunning}
                selectedIndex={selectedIndex}
                onAddCell={addItemAt}
                onSelectItem={setSelectedIndex}
                moveLimit={moveLimit}
                onMoveLimit={setMoveLimit}
              />

              {/* Live State — moved directly under the map */}
              <Card title="Live State">
                <div className="space-y-1">
                  {liveState.items.map((it) => (
                    <div key={it.id} className="flex items-center justify-between text-sm border-b border-slate-800/60 py-1">
                      <span className="text-slate-200">{iconFor(it)} {it.name}</span>
                      <StatusBadge status={it.status} />
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {liveState.inventory.length ? liveState.inventory.map((inv) => (
                    <span key={inv} className="px-2 py-1 rounded bg-indigo-500/20 text-indigo-300 text-xs border border-indigo-500/40">🎒 {inv}</span>
                  )) : <span className="text-xs text-slate-600">inventory empty</span>}
                </div>
              </Card>
            </div>

            <div className="w-full xl:flex-1">
              <Card title="🧠 Execution Trace (thought → action → result)">
                <div className="relative">
                  <div ref={traceRef} onScroll={onTraceScroll} className="max-h-[520px] overflow-y-auto pr-1 space-y-3">
                    {steps.length === 0 && <p className="text-xs text-slate-500">No steps yet. Press “Start Escaping”.</p>}
                    {steps.map((s, i) => <StepCard key={i} step={s} />)}
                  </div>
                  {showScrollBtn && (
                    <button onClick={scrollTraceToBottom} title="Jump to latest"
                      className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs shadow-lg">
                      ↓ latest
                    </button>
                  )}
                </div>
              </Card>
            </div>
          </div>
        </section>
      </main>

      {showHistory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowHistory(false)}>
          <div className="bg-slate-900 border border-slate-700 rounded-xl w-[560px] max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
              <h2 className="text-sm font-semibold text-slate-200">🕘 Escaping History <span className="text-slate-500 font-normal">(click a run to replay it)</span></h2>
              <div className="flex items-center gap-3">
                <button onClick={clearHistory} disabled={history.length === 0} title="Delete all history"
                  className="text-xs px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-white disabled:opacity-40">🗑️ Clear</button>
                <button onClick={() => setShowHistory(false)} className="text-slate-400 hover:text-slate-200">✕</button>
              </div>
            </div>
            <div className="overflow-y-auto p-3 space-y-1">
              {history.length === 0 && <p className="text-xs text-slate-500">No runs yet — press “Start Escaping” to record one.</p>}
              {history.map((h) => (
                <button key={h.num} onClick={() => loadHistoryEntry(h.num)}
                  className="w-full text-left text-xs px-3 py-2 rounded border border-slate-800 hover:bg-slate-800/60 hover:border-emerald-500/40">
                  <span className="text-sky-400 font-semibold">#{h.num}</span>
                  <span className="text-slate-400"> Room: </span>
                  <span className="text-slate-200">{h.room_name}</span>
                  <span className="text-slate-500"> — </span>
                  <span className={h.outcome === "Escaped" ? "text-emerald-400" : h.outcome === "Stuck" || h.outcome === "Out of moves" ? "text-red-400" : "text-sky-400"}>
                    {h.outcome}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- trace mutator: one entry per real backend iteration (turn) ---------- */

function mergeIter(prev, iteration, patch) {
  const n = iteration || 1;
  const idx = prev.findIndex((s) => s.iter && s.n === n);
  if (idx === -1) return [...prev, { iter: true, n, ...patch }];
  return prev.map((s, i) => (i === idx ? { ...s, ...patch } : s));
}

/* ---------- 2D map ---------- */

function RoomMap({ items, lockByName, jammedByName, agentPos, agentTool, connector, effect, confetti, confettiPieces, editable, selectedIndex, onAddCell, onSelectItem, moveLimit, onMoveLimit }) {
  const toolBadge = agentTool === "search" ? "🔍" : agentTool === "hand" ? "🖐️" : agentTool === "look" ? "👀" : null;

  // Map each cell -> item index (for the tile + click behaviour).
  const itemAtCell = {};
  items.forEach((it, i) => { if (Number.isFinite(it.x)) itemAtCell[`${it.x},${it.y}`] = i; });
  const cells = [];
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) cells.push({ x, y });

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
      <div className="flex items-center justify-between mb-1 gap-2">
        <h2 className="text-sm font-semibold text-slate-200">🧩 Room · Puzzle Editor</h2>
        <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
          move limit
          <input type="number" min={1} max={100} value={moveLimit}
            onChange={(e) => onMoveLimit(Math.max(1, Number(e.target.value) || 1))} disabled={!editable}
            className="w-14 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-xs outline-none focus:border-emerald-500 disabled:opacity-50" />
        </label>
      </div>
      <p className="text-[11px] text-slate-500 mb-2">{editable ? "click a + tile to add · click an item to edit" : "agent walks the room in real time"}</p>
      <div className="relative w-full aspect-square rounded-lg overflow-hidden border border-slate-700 bg-slate-950">
        {/* tile grid */}
        <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${GRID},1fr)`, gridTemplateRows: `repeat(${GRID},1fr)` }}>
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
              return (
                <button
                  key={`${x},${y}`}
                  onClick={() => onSelectItem?.(idx)}
                  disabled={!editable}
                  title={it.name || "unnamed"}
                  className={`relative flex flex-col items-center justify-center border border-slate-800/70 transition
                    ${selected ? "bg-emerald-500/20 ring-2 ring-emerald-500" : "bg-slate-800/30 hover:bg-slate-800/60"}
                    ${isDoor && locked === false ? "drop-shadow-[0_0_10px_#34d399]" : ""}`}
                >
                  <span className="text-3xl leading-none" style={isDoor ? { filter: locked === false ? "none" : "grayscale(0.25)" } : undefined}>
                    {iconFor(it)}
                  </span>
                  <span className="text-[8px] leading-none text-slate-300 truncate max-w-full px-0.5">{it.name || "?"}</span>
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
            {effect.kind === "unlock" ? "✨" : effect.kind === "fail" ? "❌" : effect.kind === "pickup" ? "🎒" : "🔍"}
          </span>
        )}

        {/* agent */}
        <div
          className="absolute flex flex-col items-center -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none"
          style={{ left: `${cellPct(agentPos.x)}%`, top: `${cellPct(agentPos.y)}%`, transition: "left 1.2s ease, top 1.2s ease" }}
        >
          {toolBadge && <span className="text-2xl leading-none er-bob">{toolBadge}</span>}
          <span className="text-4xl leading-none">🤖</span>
        </div>

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

/* ---------- small presentational helpers ---------- */

function Card({ title, action, children }) {
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

function Field({ label, value, onChange, disabled, placeholder }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500">{label}</span>
      <input value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} disabled={disabled}
        className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs mt-0.5 disabled:opacity-50" />
    </label>
  );
}

// Editor form for the single currently-selected item.
function ItemForm({ item, onField, disabled }) {
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

// Small copy-to-clipboard button with brief "copied" feedback.
function CopyBtn({ text, label }) {
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

function StepCard({ step }) {
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
            <div className={`text-[11px] mt-1 ${step.solved ? "text-emerald-400" : "text-amber-400"}`}>
              {step.solved ? "✓ state changed — progress made" : "✗ no state change — the agent must try something else"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function resultOk(text) {
  return !/still locked|don't have|no '|nothing happens|unknown tool|jam|wrong/i.test(text || "");
}

/* ---------- World State: one JSON object per item ---------- */

const STATUS_STYLES = {
  locked: "bg-red-500/20 text-red-300 border-red-500/40",
  unlocked: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  emptied: "bg-slate-500/20 text-slate-300 border-slate-500/40",
  escaped: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  unexamined: "bg-slate-500/20 text-slate-400 border-slate-600/40",
  examined: "bg-sky-500/20 text-sky-300 border-sky-500/40",
  jammed: "bg-rose-600/30 text-rose-200 border-rose-500/60",
};

function StatusBadge({ status }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] border ${STATUS_STYLES[status] || STATUS_STYLES.unexamined}`}>
      {status || "—"}
    </span>
  );
}

// The JSON we show for each object — API-response-like data the agent works against.
function apiJson(it) {
  const o = { id: it.id, status: it.status };
  if (it.codeRequired) o.code_required = it.codeRequired;
  if (it.keyRequired) o.key_required = it.keyRequired;
  if ("holdsItem" in it) o.holds = it.holdsItem || null;
  // Show the fragile-lock budget so the ticking counter is visible in the state panel.
  if (it.maxAttempts) o.attempts = `${it.attempts || 0}/${it.maxAttempts}`;
  if (it.isExit) o.exit = true;
  return o;
}

function StateObjectCard({ item, update }) {
  const changed = !!update;
  return (
    <div
      // key on iteration forces a remount so the flash animation replays each change
      key={changed ? `flash-${update.iteration}` : "idle"}
      className={`rounded-lg border p-2.5 bg-slate-950/60 ${changed ? "border-emerald-500 er-flash" : "border-slate-800"}`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-slate-200">{iconFor(item)} {item.name}</span>
        <StatusBadge status={item.status} />
      </div>
      <pre className="text-[11px] text-emerald-200/80 bg-black/40 rounded p-2 overflow-x-auto">
{JSON.stringify(apiJson(item), null, 2)}
      </pre>
      {changed && update.changed?.length > 0 && (
        <div className="mt-1.5 text-[11px] space-y-0.5">
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

const KEYFRAMES = `
@keyframes er-fall { 0%{transform:translateY(-10px) rotate(0);opacity:1} 100%{transform:translateY(360px) rotate(540deg);opacity:0} }
@keyframes er-pop { 0%{transform:scale(0);opacity:0} 40%{transform:scale(1.25);opacity:1} 100%{transform:scale(1);opacity:0} }
@keyframes er-bob { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-3px)} }
@keyframes er-dash { to { stroke-dashoffset: -18; } }
@keyframes er-flash { 0%{background-color:rgba(16,185,129,0.28)} 100%{background-color:rgba(2,6,23,0.6)} }
.er-fall{ animation-name:er-fall; animation-timing-function:ease-in; animation-iteration-count:infinite; }
.er-pop{ animation:er-pop 1.1s ease-out; }
.er-bob{ animation:er-bob .7s ease-in-out infinite; }
.er-dash{ animation:er-dash .6s linear infinite; }
.er-flash{ animation:er-flash 1.2s ease-out; }
`;
