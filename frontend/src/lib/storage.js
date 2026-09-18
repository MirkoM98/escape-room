const USER_ROOMS = "er_user_rooms";
const OVERRIDES = "er_room_overrides";
const HIDDEN = "er_hidden_rooms";
const HISTORY = "er_history";

const MAX_HISTORY = 15;

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function upgradeSavedRooms() {
  const rooms = read(USER_ROOMS, []);
  let changed = false;
  for (const entry of rooms) {
    for (const item of entry.room?.items || []) {
      if (!("clue" in item)) continue;
      item.description = [item.description, item.clue].map((t) => (t || "").trim()).filter(Boolean).join(" ");
      delete item.clue;
      if (!item.description) delete item.description;
      changed = true;
    }
  }
  if (changed) write(USER_ROOMS, rooms);
}

export function mergeRooms(serverRooms) {
  upgradeSavedRooms();
  const overrides = read(OVERRIDES, {});
  const hidden = read(HIDDEN, []);
  const fromServer = serverRooms
    .filter((p) => !hidden.includes(p.id))
    .map((p) => ({
      ...p,
      room: overrides[p.id] || p.room,
      custom: !p.builtin,
      edited: p.id in overrides,
    }));
  const mine = read(USER_ROOMS, []).map((p) => ({ ...p, custom: true, edited: false }));
  return [...fromServer, ...mine];
}

export function addUserRoom({ name, description, room }) {
  const rooms = read(USER_ROOMS, []);
  const entry = {
    id: `user_${Date.now().toString(36)}`,
    name,
    description: description || "Your saved room",
    room,
  };
  rooms.push(entry);
  write(USER_ROOMS, rooms);
  return entry;
}

export function saveRoomEdit(id, room) {
  const rooms = read(USER_ROOMS, []);
  const mine = rooms.find((p) => p.id === id);
  if (mine) {
    mine.room = room;
    write(USER_ROOMS, rooms);
    return;
  }
  const overrides = read(OVERRIDES, {});
  overrides[id] = room;
  write(OVERRIDES, overrides);
}

export function revertRoom(id) {
  const overrides = read(OVERRIDES, {});
  delete overrides[id];
  write(OVERRIDES, overrides);
}

export function deleteRoom(id) {
  const rooms = read(USER_ROOMS, []);
  const remaining = rooms.filter((p) => p.id !== id);
  if (remaining.length !== rooms.length) {
    write(USER_ROOMS, remaining);
    return;
  }
  const hidden = read(HIDDEN, []);
  if (!hidden.includes(id)) {
    hidden.push(id);
    write(HIDDEN, hidden);
  }
}

export function listRuns() {
  return read(HISTORY, []).slice().reverse();
}

export function getRun(num) {
  return read(HISTORY, []).find((r) => r.num === num) || null;
}

export function clearRuns() {
  write(HISTORY, []);
}

export function appendRun(entry) {
  const runs = read(HISTORY, []);
  const num = runs.length ? runs[runs.length - 1].num + 1 : 1;
  runs.push({ ...entry, num });
  let keep = runs.slice(-MAX_HISTORY);
  while (keep.length && !write(HISTORY, keep)) keep = keep.slice(1);
  return num;
}
