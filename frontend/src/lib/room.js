export const AGENT_ACTIONS = [
  { icon: "👁️", name: "look_around()", desc: "Survey the room — lists the names of every visible item. It does NOT say what is locked." },
  { icon: "🔍", name: "investigate_item(name)", desc: "Read an item's description + clue. If it holds something and is unlocked, the agent takes it." },
  { icon: "🖐️", name: "use_item_on_target(item, target)", desc: "Enter a code, or use a key from inventory, to unlock a target." },
  { icon: "🚪", name: "escape()", desc: "Try to leave. Works only once the exit door is unlocked." },
];

export const EMPTY_ITEM = () => ({
  id: "", name: "", description: "", isVisible: true, isLocked: false,
  codeRequired: "", keyRequired: "", holdsItem: "", clue: "", isExit: false,
  maxAttempts: "", x: undefined, y: undefined,
});

export function cleanItem(raw, index) {
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
