import React, { useEffect, useMemo, useRef, useState } from "react";

import { ItemForm } from "./components/ItemForm";
import { RoomMap } from "./components/RoomMap";
import { StateObjectCard } from "./components/StateObjectCard";
import { StepCard } from "./components/StepCard";
import { Card, StatusBadge } from "./components/ui";
import { archiveRun, fetchHistory, fetchRun, getJson, streamRun } from "./lib/api";
import { AGENT_START, GRID, assignPositions, freeCell, iconFor, norm, sleep } from "./lib/grid";
import { KEYFRAMES } from "./lib/keyframes";
import { AGENT_ACTIONS, EMPTY_ITEM, cleanItem } from "./lib/room";
import {
  addUserRoom, appendRun, clearRuns, deleteRoom, getRun,
  listRuns, mergeRooms, revertRoom, saveRoomEdit,
} from "./lib/storage";
import { isMuted, setMuted, soundtrackEnabled, startSoundtrack, stopSoundtrack } from "./lib/soundtrack";
import { mergeIter } from "./lib/trace";

const HISTORY_SOURCE = {
  postgres: "every run, from everyone",
  file: "every run recorded on this server",
  none: "this browser only",
};

export default function EscapeRoom() {
  const [moveLimit, setMoveLimit] = useState(() => Number(localStorage.getItem("er_move_limit")) || 15);
  const [provider, setProvider] = useState(() => localStorage.getItem("er_provider") || "auto");
  const [hasCli, setHasCli] = useState(false);
  const [forcedProvider, setForcedProvider] = useState(null);
  const [maxMoveLimit, setMaxMoveLimit] = useState(40);
  // Resizable split: width of the LEFT column (percent); the right column flexes.
  const [leftWidth, setLeftWidth] = useState(() => Number(localStorage.getItem("er_left_w")) || 40);
  const [isWide, setIsWide] = useState(true);
  const [leftCollapsed, setLeftCollapsed] = useState(() => localStorage.getItem("er_left_collapsed") === "1");
  const collapseLeft = (next) => {
    setLeftCollapsed(next);
    localStorage.setItem("er_left_collapsed", next ? "1" : "0");
  };
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
  const [historyStore, setHistoryStore] = useState("none");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [muted, setMutedState] = useState(isMuted);
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

  const abortRef = useRef(null);
  const streamEndedRef = useRef(false);
  const doneRef = useRef(false);
  const traceRef = useRef(null);
  const atBottomRef = useRef(true);
  const itemsRef = useRef([]);
  const stepsRef = useRef([]);
  const roomNameRef = useRef("Custom room");
  const agentPosRef = useRef(AGENT_START);
  const queueRef = useRef([]);
  const drainingRef = useRef(false);
  const runIdRef = useRef(0);
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
    getJson("/api/health")
      .then((h) => {
        setHasCli(!!h.has_cli);
        setForcedProvider(h.forced_provider || null);
        if (h.forced_provider) setProvider(h.forced_provider);
        else if (!h.has_cli) setProvider((p) => (p === "cli" ? "auto" : p));
        if (h.max_move_limit) {
          setMaxMoveLimit(h.max_move_limit);
          setMoveLimit((m) => Math.min(h.max_move_limit, Math.max(1, m)));
        }
      })
      .catch(() => {});
    getJson("/api/default-room")
      .then((data) => {
        const room = data.room || { items: [], inventory: [] };
        const seeded = assignPositions(room.items.map((it) => ({ ...EMPTY_ITEM(), ...it })));
        setItems(seeded);
        setLiveState({ items: seeded, inventory: room.inventory || [], escaped: false });
      })
      .catch(() => setError("Could not reach the backend at /api. Is the server running on :8000?"));
    refreshPresets();
    return () => { abortRef.current?.abort(); stopSoundtrack(); };
  }, []);

  const refreshPresets = () =>
    getJson("/api/presets")
      .then((data) => {
        const merged = mergeRooms(data.presets || []);
        setPresets(merged);
        return merged;
      })
      .catch(() => []);

  const loadPreset = (room, name) => {
    reset(false);
    const seeded = assignPositions(room.items.map((it) => ({ ...EMPTY_ITEM(), ...it })));
    setItems(seeded);
    setLiveState({ items: seeded.map(cleanItem), inventory: [], escaped: false });
    setSelectedIndex(null);
    if (name) setRoomName(name);
  };

  const saveRun = (finalSteps, reason, finalState) => {
    const outcome =
      reason === "escaped" ? "Escaped"
      : reason === "out_of_moves" ? "Out of moves"
      : reason === "cant_solve" ? "Stuck"
      : "Ended";
    const record = {
      room_name: roomNameRef.current,
      outcome,
      room: { items: itemsRef.current.map(cleanItem), inventory: [] },
      steps: finalSteps,
      state: finalState || null,
    };
    appendRun(record);
    archiveRun(record);
  };

  const openHistory = async () => {
    setShowHistory(true);
    setHistoryLoading(true);
    const data = await fetchHistory();
    setHistoryLoading(false);
    if (data.store && data.store !== "none") {
      setHistoryStore(data.store);
      setHistory((data.runs || []).map((r) => ({ ...r, shared: true })));
      return;
    }
    setHistoryStore("none");
    setHistory(listRuns().map((r) => ({ ...r, shared: false })));
  };

  const clearHistory = () => {
    if (!window.confirm("Delete ALL escaping history? This cannot be undone.")) return;
    clearRuns();
    setHistory([]);
  };

  // Load a past run: reload its room and replay its finished execution trace.
  const loadHistoryEntry = async (summary) => {
    const entry = summary.shared ? await fetchRun(summary.num) : getRun(summary.num);
    if (entry) {
        runIdRef.current++;
        abortRef.current?.abort();
        queueRef.current = [];
        drainingRef.current = false;
        const seeded = assignPositions((entry.room.items || []).map((it) => ({ ...EMPTY_ITEM(), ...it })));
        setItems(seeded);
        setLiveState(entry.state || { items: seeded.map(cleanItem), inventory: [], escaped: false });
        setSteps(entry.steps || []);
        setMoves({ used: (entry.steps || []).filter((s) => s.action).length, limit: moveLimit });
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
    }
  };

  const saveCurrentAsPreset = async () => {
    const name = window.prompt("Name this preset:", "My room");
    if (!name || !name.trim()) return;
    addUserRoom({
      name: name.trim(),
      description: "Your saved room",
      room: { items: items.map(cleanItem), inventory: [] },
    });
    await refreshPresets();
  };

  const deleteCustomPreset = async (id) => {
    deleteRoom(id);
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
    saveRoomEdit(editingId, room);
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
    revertRoom(id);
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
  const selectItem = (index) => {
    setSelectedIndex(index);
    if (leftCollapsed) collapseLeft(false);
  };

  const addItemAt = (x, y) => {
    markCustom();
    if (leftCollapsed) collapseLeft(false);
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
    startSoundtrack();
    reset(true);
    setStatus("Running...");
    localStorage.setItem("er_move_limit", String(moveLimit));
    localStorage.setItem("er_provider", provider);
    const myRun = ++runIdRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    streamEndedRef.current = false;
    doneRef.current = false;

    const room = { items: items.map(cleanItem), inventory: [] };
    setLiveState({ items: room.items, inventory: [], escaped: false });

    try {
      await streamRun(
        { room, move_limit: moveLimit, provider },
        (event) => {
          if (runIdRef.current !== myRun) return;
          queueRef.current.push(event);
          drain(myRun);
        },
        controller.signal,
      );
      streamEndedRef.current = true;
      drain(myRun);
    } catch (err) {
      if (err.name === "AbortError" || runIdRef.current !== myRun) return;
      setStatus("Error");
      setError(err.message);
    }
  };

  const drain = async (myRun) => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    try {
      while (queueRef.current.length && runIdRef.current === myRun) {
        const ev = queueRef.current.shift();
        await handleEvent(ev, myRun);
      }
    } catch (err) {
      setStatus("Error");
      setError(`Playback failed: ${err.message}`);
      queueRef.current = [];
    } finally {
      drainingRef.current = false;
    }
    if (streamEndedRef.current && !doneRef.current && runIdRef.current === myRun && !queueRef.current.length) {
      setStatus("Error");
      setError("The run stream ended before the agent finished.");
    }
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
        const after = event.update?.after || {};
        const jammed = after.status === "jammed";
        const success = !jammed && !!event.update?.changed?.includes("isLocked") && after.isLocked === false;
        setSteps((prev) => mergeIter(prev, event.iteration, { result: event.text, solved: !!event.update?.solved && !jammed, update: event.update, jammed }));
        if (event.update?.target) setLastUpdate({ ...event.update, iteration: event.iteration });
        const c = coordsFor(event.update?.target_name) || agentPosRef.current;
        if (event.tool === "use_item_on_target") {
          setConnector((k) => (k ? { ...k, ok: success } : null));
          setEffect({ x: c.x, y: c.y, kind: jammed ? "jam" : success ? "unlock" : "fail" });
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
        doneRef.current = true;
        stopSoundtrack();
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
    if (!keepConfigOnly) stopSoundtrack();
    runIdRef.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    streamEndedRef.current = false;
    doneRef.current = false;
    queueRef.current = [];
    drainingRef.current = false;
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
              <p className="text-xs text-slate-400 leading-relaxed">
                Click a <span className="text-emerald-400 font-bold">+</span> tile on the room grid to add an item, or click an
                existing item to edit it here. Build a chain: a clue points to a code/key → that opens a container → the
                container holds the next key → until the exit door opens.
              </p>
            )}
          </Card>

          {/* World State — moved under the Item Editor (left column) */}
          <Card title="🗃️ World State (JSON)">
            <div className="grid grid-cols-1 gap-3">
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
              onClick={() => collapseLeft(!leftCollapsed)}
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
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">{selectedPreset.description}</p>
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
              className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold disabled:opacity-40">{soundtrackEnabled() ? "▶ Start Fiken" : "▶ Start Escaping"}</button>
            <button onClick={() => reset(false)} className="px-4 py-2 rounded bg-red-600 hover:bg-red-500 text-sm font-semibold">↺ Reset Game</button>
            {soundtrackEnabled() && (
              <button
                onClick={() => { const next = !muted; setMuted(next); setMutedState(next); }}
                title={muted ? "Sound is off" : "Sound plays while a run is going"}
                className="px-3 py-2 rounded text-sm border border-slate-600 bg-slate-800 hover:bg-slate-700 text-slate-300">
                {muted ? "🔇" : "🔊"}
              </button>
            )}
            <label className="flex items-center gap-1.5 text-xs text-slate-400"
              title="How the backend reaches Claude: auto (API key, else CLI) · api (needs ANTHROPIC_API_KEY) · cli (local Claude Code login, no key)">
              <span>Claude via</span>
              {forcedProvider ? (
                <span className="px-2 py-1.5 rounded border border-slate-700 bg-slate-900/60 text-xs text-slate-300"
                  title="Pinned by the server (ESCAPE_ROOM_PROVIDER). The deployment always uses the Anthropic API.">
                  {forcedProvider}
                </span>
              ) : (
                <select value={provider} onChange={(e) => setProvider(e.target.value)} disabled={isRunning}
                  className="bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200 disabled:opacity-50">
                  <option value="auto">auto (key → CLI)</option>
                  <option value="api">api (token)</option>
                  {hasCli && <option value="cli">cli (local only)</option>}
                </select>
              )}
              {provider === "cli" && <span className="text-[10px] text-amber-400" title="Each move spawns a fresh `claude -p` process">~7s/move</span>}
            </label>
            <div className="ml-auto flex items-center gap-4 text-xs">
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
                onSelectItem={selectItem}
                moveLimit={moveLimit}
                onMoveLimit={setMoveLimit}
                maxMoveLimit={maxMoveLimit}
                showAgent={status !== "Idle"}
                dj={soundtrackEnabled() && isRunning && !muted}
              />

              {/* Live State — moved directly under the map */}
              <Card title="Live State">
                <div className="space-y-1">
                  {liveState.items.map((it) => (
                    <div key={it.id} className="flex items-center justify-between text-sm border-b border-slate-800/60 py-1">
                      <span className="text-slate-100 font-medium">{iconFor(it)} {it.name}</span>
                      <StatusBadge status={it.status} />
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {liveState.inventory.length ? liveState.inventory.map((inv) => (
                    <span key={inv} className="px-2.5 py-1 rounded-md bg-indigo-500/20 text-indigo-200 text-xs font-medium border border-indigo-500/50">🎒 {inv}</span>
                  )) : <span className="text-xs text-slate-500">inventory empty</span>}
                </div>
              </Card>
            </div>

            <div className="w-full xl:flex-1">
              <Card title="🧠 Execution Trace (thought → action → result)">
                <div className="relative">
                  <div ref={traceRef} onScroll={onTraceScroll} className="max-h-[520px] overflow-y-auto pr-1 space-y-3">
                    {steps.length === 0 && <p className="text-sm text-slate-400">No steps yet. Press “Start Escaping”.</p>}
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
              <h2 className="text-sm font-semibold text-slate-200">🕘 Escaping History <span className="text-slate-500 font-normal">({HISTORY_SOURCE[historyStore]} · click one to replay)</span></h2>
              <div className="flex items-center gap-3">
                {historyStore === "none" && (
                  <button onClick={clearHistory} disabled={history.length === 0} title="Delete all history"
                    className="text-xs px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-white disabled:opacity-40">🗑️ Clear</button>
                )}
                <button onClick={() => setShowHistory(false)} className="text-slate-400 hover:text-slate-200">✕</button>
              </div>
            </div>
            <div className="overflow-y-auto p-3 space-y-1">
              {historyLoading ? (
                <div className="flex items-center gap-2 px-3 py-6 text-xs text-slate-400">
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-slate-600 border-t-emerald-400 animate-spin" />
                  Loading runs…
                </div>
              ) : history.length === 0 ? (
                <p className="text-xs text-slate-500">No runs yet — press “Start Escaping” to record one.</p>
              ) : null}
              {history.map((h) => (
                <button key={h.num} onClick={() => loadHistoryEntry(h)}
                  className="w-full text-left text-xs px-3 py-2 rounded border border-slate-800 hover:bg-slate-800/60 hover:border-emerald-500/40">
                  <span className="text-sky-400 font-semibold">#{h.num}</span>
                  <span className="text-slate-400"> Room: </span>
                  <span className="text-slate-200">{h.room_name}</span>
                  <span className="text-slate-500"> — </span>
                  <span className={h.outcome === "Escaped" ? "text-emerald-400" : h.outcome === "Stuck" || h.outcome === "Out of moves" ? "text-red-400" : "text-sky-400"}>
                    {h.outcome}
                  </span>
                  {h.moves ? <span className="text-slate-600"> · {h.moves} moves</span> : null}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
