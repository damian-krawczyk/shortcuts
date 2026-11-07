// Shortcuts model: shortcuts.md ⇄ a tree of folders (OS → software → sections) holding shortcuts.
// Shared by the CLI/server (Node) and the page (browser), so both read and
// write the file the same way.
//
// Format:
//   ---                                           ← YAML front matter (optional)
//   title: My shortcuts
//   ---
//   # macOS                                       ← level 1: operating system
//   version: 15 Sequoia                           ← optional version of the OS / software
//   - [x] `Cmd+Space` Spotlight                   ← system-wide shortcut; [x] = favorite
//   ## VS Code                                    ← level 2: software
//   version: 1.95
//   ### Editing                                   ← level 3–6: optional sections
//   - [ ] `Cmd+K Cmd+S` / `F1` Keyboard Shortcuts — description
//     tags: #settings
//     version: 1.90+                              ← per-shortcut version (overrides the folder's)
//     a second line of description
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ShortcutsModel = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const TITLE_RE = /^<!--\s*title:\s*(.*?)\s*-->\s*$/i; // older files; written back as front matter
  const FRONT_TITLE_RE = /^title:\s*(.*?)\s*$/;
  const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
  // - [x] `Keys` / `More keys` Action — description   (the checkbox is optional when reading)
  const ENTRY_RE = /^[-*+]\s+(?:\[([ xX])\]\s+)?((?:`[^`]+`\s*(?:[\/,|]\s*)?)+)(.*)$/;
  const DESC_SPLIT_RE = /\s+(?:—|–|--?)\s+/;
  const TAGS_RE = /^tags:\s*(.*)$/i;
  const VERSION_RE = /^version:\s*(.*?)\s*$/i;
  const MAX_DEPTH = 6;

  let nextId = 1;
  const newId = () => "s" + nextId++;

  function newFolder(name) {
    return { name, version: "", folders: [], entries: [], notes: [] };
  }

  function emptyModel(title) {
    // front: other front matter lines, kept as written.
    return { title: title || "", front: [], root: newFolder("") };
  }

  // ---- front matter ----------------------------------------------------------
  // A YAML block between "---" lines at the very top. `title` is read; every other line is kept
  // verbatim, so keys other tools use survive a save.

  function yamlString(v) {
    v = String(v).trim();
    if (v.startsWith('"')) { try { return String(JSON.parse(v)); } catch (_) { /* fall through */ } }
    if (v.length > 1 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
    return v.replace(/\s+#.*$/, "");
  }

  // Quote a value only when plain YAML would read it differently.
  function yamlQuote(v) {
    v = String(v);
    const plain = v && v === v.trim() && !/^[-?:,\[\]{}#&*!|>'"%@`]/.test(v) && !/:\s|\s#|:$/.test(v)
      && !/^(true|false|yes|no|on|off|null|~|[-+]?(\d[\d_]*(\.\d*)?|\.\d+)([eE][-+]?\d+)?)$/i.test(v);
    return plain ? v : JSON.stringify(v);
  }

  // → { title, front, rest } (rest = the lines after the block), or null if there is no block.
  function splitFrontMatter(lines) {
    if ((lines[0] || "").trim() !== "---") return null;
    const end = lines.findIndex((l, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(l));
    if (end < 0) return null;
    let title = "";
    const front = [];
    for (const l of lines.slice(1, end)) {
      const m = FRONT_TITLE_RE.exec(l);
      if (m && !title) title = yamlString(m[1]);
      else front.push(l);
    }
    while (front.length && !front[front.length - 1].trim()) front.pop();
    return { title, front, skip: end + 1 };
  }

  // ---- keys ------------------------------------------------------------------
  // A shortcut has one or more alternative combos ("Cmd+D", "Cmd+Shift+L").
  // A combo is one or more chord steps separated by spaces ("Cmd+K Cmd+S").
  // A step is modifiers + one key, joined with "+". Stored in plain ASCII.

  const MODIFIERS = ["Fn", "Win", "Super", "Ctrl", "Alt", "Shift", "Cmd", "Meta"];
  const KEY_ALIASES = {
    fn: "Fn", ctrl: "Ctrl", control: "Ctrl", ctl: "Ctrl", "⌃": "Ctrl", "^": "Ctrl",
    alt: "Alt", opt: "Alt", option: "Alt", "⌥": "Alt",
    shift: "Shift", "⇧": "Shift",
    cmd: "Cmd", command: "Cmd", "⌘": "Cmd",
    win: "Win", windows: "Win", "⊞": "Win", super: "Super", meta: "Meta",
    esc: "Esc", escape: "Esc", "⎋": "Esc",
    enter: "Enter", return: "Enter", "↩": "Enter", "↵": "Enter", "⏎": "Enter",
    tab: "Tab", "⇥": "Tab", space: "Space", spacebar: "Space", "␣": "Space",
    backspace: "Backspace", "⌫": "Backspace", delete: "Delete", del: "Delete", "⌦": "Delete",
    insert: "Insert", ins: "Insert", home: "Home", end: "End", "↖": "Home", "↘": "End",
    pageup: "PageUp", pgup: "PageUp", "⇞": "PageUp", pagedown: "PageDown", pgdn: "PageDown", pgdown: "PageDown", "⇟": "PageDown",
    up: "Up", arrowup: "Up", "↑": "Up", down: "Down", arrowdown: "Down", "↓": "Down",
    left: "Left", arrowleft: "Left", "←": "Left", right: "Right", arrowright: "Right", "→": "Right",
    plus: "Plus", "+": "Plus", minus: "Minus", backtick: "Backtick", capslock: "CapsLock", "⇪": "CapsLock",
    printscreen: "PrintScreen", prtsc: "PrintScreen", click: "Click",
  };

  function canonicalKey(k) {
    const raw = String(k || "").trim();
    if (!raw) return "";
    const alias = KEY_ALIASES[raw.toLowerCase()];
    if (alias) return alias;
    if (/^f\d{1,2}$/i.test(raw)) return raw.toUpperCase();
    if (raw.length === 1) return raw.toUpperCase();
    return raw[0].toUpperCase() + raw.slice(1);
  }

  const isModifier = (k) => MODIFIERS.includes(k);

  // "cmd+shift+p" → "Shift+Cmd+P": canonical names, modifiers in the order Fn, Win/Super, Ctrl, Alt, Shift, Cmd/Meta
  // (Windows writes Win+Shift+S; macOS writes ⌃⌥⇧⌘).
  function normalizeStep(step) {
    let parts = String(step).split("+");
    // "Cmd++" or "+" → the plus key.
    if (parts.length > 1 && parts[parts.length - 1] === "" && parts[parts.length - 2] === "") parts = parts.slice(0, -2).concat("+");
    const keys = parts.map(canonicalKey).filter(Boolean);
    if (!keys.length) return "";
    const mods = MODIFIERS.filter((m) => keys.includes(m));
    const rest = keys.filter((k) => !isModifier(k));
    // A step made only of modifiers ("Shift" in "Shift Shift") keeps its last one as the key.
    return mods.concat(rest.filter((k, i) => rest.indexOf(k) === i)).join("+");
  }

  function normalizeCombo(combo) {
    return String(combo || "").trim().split(/\s+/).map(normalizeStep).filter(Boolean).join(" ");
  }

  // "Cmd+D / Cmd+Shift+L" (or an array) → ["Cmd+D", "Cmd+Shift+L"]
  function parseKeys(input) {
    const list = Array.isArray(input) ? input : String(input || "").split(/\s*\n\s*|\s+\/\s+/);
    const out = [];
    for (const k of list) {
      const c = normalizeCombo(String(k).replace(/`/g, ""));
      if (c && !out.includes(c)) out.push(c);
    }
    return out;
  }

  // Which family of keyboard a heading names, for how keys are drawn ("linux" = PC names).
  function osKind(name) {
    const n = String(name || "").toLowerCase();
    if (/mac|os ?x|darwin|ios|ipad|apple/.test(n)) return "mac";
    if (/win/.test(n)) return "win";
    return "linux";
  }

  const MAC_SYMBOLS = {
    Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Cmd: "⌘", Fn: "fn", Enter: "↩", Backspace: "⌫", Delete: "⌦", Tab: "⇥",
    Esc: "Esc", Up: "↑", Down: "↓", Left: "←", Right: "→", PageUp: "⇞", PageDown: "⇟", Home: "↖", End: "↘",
    CapsLock: "⇪", Plus: "+", Minus: "-", Backtick: "`", Space: "Space",
  };
  const PC_NAMES = { Up: "↑", Down: "↓", Left: "←", Right: "→", Plus: "+", Minus: "-", Backtick: "`" };

  // One combo → chord steps → keys, labelled for that OS:
  // formatCombo("Cmd+K Cmd+S", "mac") → [["⌘", "K"], ["⌘", "S"]]
  function formatCombo(combo, kind) {
    const names = kind === "mac" ? MAC_SYMBOLS : PC_NAMES;
    return normalizeCombo(combo).split(" ").filter(Boolean).map((step) => {
      const parts = step.split("+");
      return parts.map((k) => names[k] || k);
    });
  }

  // ---- tags & names ----------------------------------------------------------

  // "#a, b  #c d" → ["a", "b", "c", "d"]; tags never contain spaces or commas.
  function parseTags(text) {
    const out = [];
    for (const raw of String(text || "").split(/[\s,]+/)) {
      const t = cleanTag(raw);
      if (t && !out.includes(t)) out.push(t);
    }
    return out;
  }

  function cleanTag(t) {
    return String(t || "").trim().replace(/^#+/, "").replace(/[\s,#]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function cleanFolderName(n) {
    return String(n || "").replace(/[\/\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  }

  const cleanVersion = (v) => String(v || "").replace(/\s+/g, " ").trim();

  // ---- parse / serialize -----------------------------------------------------

  function parseEntryLine(m) {
    const keys = parseKeys([...m[2].matchAll(/`([^`]+)`/g)].map((x) => x[1]));
    const rest = m[3].trim();
    const at = rest.search(DESC_SPLIT_RE);
    const action = at >= 0 ? rest.slice(0, at).trim() : rest;
    const description = at >= 0 ? rest.slice(at).replace(DESC_SPLIT_RE, "").trim() : "";
    return { id: newId(), keys, action, description, tags: [], version: "", favorite: /x/i.test(m[1] || "") };
  }

  function parse(text) {
    const model = emptyModel();
    const warnings = [];
    const lines = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
    const fm = splitFrontMatter(lines);
    if (fm) { model.title = fm.title; model.front = fm.front; }
    let stack = [model.root]; // stack[d] = folder at depth d
    let last = null; // entry that indented lines continue

    lines.forEach((line, i) => {
      const n = i + 1;
      if ((fm && i < fm.skip) || !line.trim()) return;
      let m;
      if (!model.title && (m = TITLE_RE.exec(line.trim()))) { model.title = m[1]; last = null; return; }
      if ((m = HEADING_RE.exec(line))) {
        const level = m[1].length;
        const name = cleanFolderName(m[2]);
        const parentDepth = Math.min(level - 1, stack.length - 1);
        if (parentDepth < level - 1) warnings.push({ line: n, message: `heading level ${level} skips a level` });
        const parent = stack[parentDepth];
        let folder = parent.folders.find((f) => f.name === name);
        if (folder) warnings.push({ line: n, message: `"${name}" appears twice; merged` });
        else parent.folders.push((folder = newFolder(name)));
        stack = stack.slice(0, parentDepth + 1).concat(folder);
        last = null;
        return;
      }
      if (/^\s/.test(line) && last) {
        const body = line.trim();
        if ((m = TAGS_RE.exec(body))) last.tags = last.tags.concat(parseTags(m[1]).filter((t) => !last.tags.includes(t)));
        else if ((m = VERSION_RE.exec(body)) && !last.version) last.version = cleanVersion(m[1]);
        else last.description = last.description ? last.description + "\n" + body : body;
        return;
      }
      const folder = stack[stack.length - 1];
      if ((m = VERSION_RE.exec(line)) && folder !== model.root) {
        if (folder.version) warnings.push({ line: n, message: `"${folder.name}" has a second version line; kept the first` });
        else folder.version = cleanVersion(m[1]);
        last = null;
        return;
      }
      if ((m = ENTRY_RE.exec(line))) {
        const entry = parseEntryLine(m);
        folder.entries.push(entry);
        last = entry;
        return;
      }
      folder.notes.push(line);
      warnings.push({ line: n, message: `not a shortcut, kept as a note: ${line.trim().slice(0, 60)}` });
      last = null;
    });
    return { model, warnings };
  }

  function serializeEntry(e) {
    const [first, ...rest] = String(e.description || "").split("\n").map((s) => s.trim()).filter((s, i) => s || i === 0);
    const keys = (e.keys || []).map((k) => "`" + k + "`").join(" / ");
    let out = `- [${e.favorite ? "x" : " "}] ${keys}` + (e.action ? ` ${e.action}` : "") + (first ? ` — ${first}` : "") + "\n";
    if (e.tags && e.tags.length) out += `  tags: ${e.tags.map((t) => "#" + t).join(" ")}\n`;
    if (e.version) out += `  version: ${e.version}\n`;
    for (const r of rest) if (r) out += `  ${r}\n`;
    return out;
  }

  function serialize(model) {
    const blocks = [];
    const front = (model.title ? [`title: ${yamlQuote(model.title)}`] : []).concat(model.front || []);
    if (front.length) blocks.push(`---\n${front.join("\n")}\n---\n`);
    const body = (folder) => {
      let out = "";
      if (folder.notes.length) out += folder.notes.join("\n") + "\n";
      if (folder.notes.length && folder.entries.length) out += "\n";
      out += folder.entries.map(serializeEntry).join("");
      return out;
    };
    const rootBody = body(model.root);
    if (rootBody) blocks.push(rootBody);
    const walk = (folder, depth) => {
      for (const f of folder.folders) {
        const b = body(f);
        blocks.push(`${"#".repeat(Math.min(depth, MAX_DEPTH))} ${f.name}\n` + (f.version ? `version: ${f.version}\n` : "") + (b ? "\n" + b : ""));
        walk(f, depth + 1);
      }
    };
    walk(model.root, 1);
    return blocks.join("\n");
  }

  // ---- queries ---------------------------------------------------------------

  function findFolder(model, path, create) {
    let f = model.root;
    if (create && (path || []).filter((p) => cleanFolderName(p)).length > MAX_DEPTH) {
      throw new Error(`folders can be nested at most ${MAX_DEPTH} levels deep (Markdown has 6 heading levels)`);
    }
    for (const raw of path || []) {
      const name = cleanFolderName(raw);
      if (!name) continue;
      let next = f.folders.find((c) => c.name === name);
      if (!next) {
        if (!create) return null;
        f.folders.push((next = newFolder(name)));
      }
      f = next;
    }
    return f;
  }

  // Every entry with the folder path it lives in, in file order.
  function allEntries(model) {
    const out = [];
    const walk = (folder, path) => {
      for (const e of folder.entries) out.push({ entry: e, path });
      for (const f of folder.folders) walk(f, path.concat(f.name));
    };
    walk(model.root, []);
    return out;
  }

  function allFolders(model) {
    const out = [];
    const walk = (folder, path) => {
      for (const f of folder.folders) {
        const p = path.concat(f.name);
        out.push({ folder: f, path: p });
        walk(f, p);
      }
    };
    walk(model.root, []);
    return out;
  }

  function locate(model, id) {
    const walk = (folder, path) => {
      const i = folder.entries.findIndex((e) => e.id === id);
      if (i >= 0) return { folder, index: i, entry: folder.entries[i], path };
      for (const f of folder.folders) {
        const r = walk(f, path.concat(f.name));
        if (r) return r;
      }
      return null;
    };
    return walk(model.root, []);
  }

  function countEntries(folder, pred) {
    const own = pred ? folder.entries.filter(pred).length : folder.entries.length;
    return own + folder.folders.reduce((s, f) => s + countEntries(f, pred), 0);
  }

  // tag → number of entries, sorted by count then name.
  function tagCounts(model) {
    const m = new Map();
    for (const { entry } of allEntries(model)) for (const t of entry.tags) m.set(t, (m.get(t) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }

  const splitPath = (s) => String(s || "").split("/").map(cleanFolderName).filter(Boolean);

  // Each level of a shortcut's folder path with that folder's version. The levels mean whatever
  // the file says (OS, software, project…). The shortcut's own version overrides the deepest
  // version set above it (or, if none is, is shown on its own folder).
  // `version` is what a shortcut there inherits; `kind` picks the key symbols (see kindOf).
  function context(model, path, entry) {
    const levels = [];
    let f = model.root;
    for (const name of path) {
      f = f && f.folders.find((c) => c.name === name);
      levels.push({ name, version: (f && f.version) || "" });
    }
    let deepest = -1;
    levels.forEach((l, i) => { if (l.version) deepest = i; });
    const version = deepest >= 0 ? levels[deepest].version : "";
    if (entry && entry.version && levels.length) levels[deepest >= 0 ? deepest : levels.length - 1].version = entry.version;
    return { levels, version, kind: kindOf(path) };
  }

  // Which keyboard a folder path is about: the first level that names a known OS family
  // ("macOS", "Windows 11"…), at any depth; otherwise the PC names (Ctrl, Alt…).
  function kindOf(path) {
    for (const name of path || []) {
      const k = osKind(name);
      if (k !== "linux") return k;
    }
    return "linux";
  }

  // ---- edits (mutate the model) ---------------------------------------------

  function normalizeEntry(fields) {
    return {
      keys: parseKeys(fields.keys),
      action: String(fields.action || "").replace(/\s+/g, " ").trim(),
      description: String(fields.description || "").replace(/\r\n?/g, "\n").trim(),
      tags: Array.isArray(fields.tags) ? parseTags(fields.tags.join(" ")) : parseTags(fields.tags),
      version: cleanVersion(fields.version),
      favorite: !!fields.favorite,
    };
  }

  function addEntry(model, path, fields) {
    const entry = Object.assign({ id: newId() }, normalizeEntry(fields));
    findFolder(model, path, true).entries.push(entry);
    return entry;
  }

  function updateEntry(model, id, fields, path) {
    const loc = locate(model, id);
    if (!loc) throw new Error(`no shortcut ${id}`);
    Object.assign(loc.entry, normalizeEntry(Object.assign({}, loc.entry, fields)));
    if (path && path.join("/") !== loc.path.join("/")) {
      loc.folder.entries.splice(loc.index, 1);
      findFolder(model, path, true).entries.push(loc.entry);
    }
    return loc.entry;
  }

  function toggleFavorite(model, id, value) {
    const loc = locate(model, id);
    if (!loc) return null;
    loc.entry.favorite = value === undefined ? !loc.entry.favorite : !!value;
    return loc.entry;
  }

  function deleteEntry(model, id) {
    const loc = locate(model, id);
    if (!loc) return false;
    loc.folder.entries.splice(loc.index, 1);
    return true;
  }

  function addFolder(model, path) {
    return findFolder(model, path, true);
  }

  function setFolderVersion(model, path, version) {
    const f = path && path.length ? findFolder(model, path) : null;
    if (!f) return null;
    f.version = cleanVersion(version);
    return f;
  }

  function parentOf(model, path) {
    return path.length > 1 ? findFolder(model, path.slice(0, -1)) : model.root;
  }

  // Rename a folder; if a sibling already has the new name, the two merge.
  function renameFolder(model, path, newName) {
    newName = cleanFolderName(newName);
    const parent = parentOf(model, path);
    const folder = findFolder(model, path);
    if (!folder || !parent || !newName || newName === folder.name) return folder;
    const other = parent.folders.find((f) => f.name === newName);
    if (other) {
      parent.folders.splice(parent.folders.indexOf(folder), 1);
      mergeInto(other, folder);
      return other;
    }
    folder.name = newName;
    return folder;
  }

  function mergeInto(target, src) {
    if (!target.version) target.version = src.version;
    target.entries.push(...src.entries);
    target.notes.push(...src.notes);
    for (const f of src.folders) {
      const same = target.folders.find((t) => t.name === f.name);
      if (same) mergeInto(same, f);
      else target.folders.push(f);
    }
  }

  // Move a folder (with its contents) under another folder ([] = top level).
  function moveFolder(model, path, newParentPath) {
    const folder = findFolder(model, path);
    const parent = parentOf(model, path);
    if (!folder || !parent) return null;
    const dest = newParentPath.join("/");
    const self = path.join("/");
    if (dest === self || dest.startsWith(self + "/")) return null; // into itself
    if (newParentPath.join("/") === path.slice(0, -1).join("/")) return folder;
    if (newParentPath.length + 1 + folderDepth(folder) > MAX_DEPTH) {
      throw new Error(`folders can be nested at most ${MAX_DEPTH} levels deep (Markdown has 6 heading levels)`);
    }
    parent.folders.splice(parent.folders.indexOf(folder), 1);
    const target = findFolder(model, newParentPath, true);
    const same = target.folders.find((f) => f.name === folder.name);
    if (same) { mergeInto(same, folder); return same; }
    target.folders.push(folder);
    return folder;
  }

  // How many levels of subfolders a folder has below it (0 = none).
  function folderDepth(folder) {
    return folder.folders.reduce((m, f) => Math.max(m, 1 + folderDepth(f)), 0);
  }

  function deleteFolder(model, path) {
    const parent = parentOf(model, path);
    const folder = findFolder(model, path);
    if (!folder || !parent || folder === model.root) return false;
    parent.folders.splice(parent.folders.indexOf(folder), 1);
    return true;
  }

  // ---- validation ------------------------------------------------------------

  // Other shortcuts under the same first two levels (e.g. OS + software) that use one of `keys`.
  function conflicts(model, path, keys, exceptId) {
    const scope = path.slice(0, 2).join("/");
    const want = parseKeys(keys);
    return allEntries(model).filter(({ entry, path: p }) => entry.id !== exceptId && p.slice(0, 2).join("/") === scope
      && entry.keys.some((k) => want.includes(k)));
  }

  function validate(text) {
    const { model, warnings } = parse(text);
    const errors = [];
    const seen = new Map(); // "OS/Software␀version␀combo" → where
    for (const { entry, path } of allEntries(model)) {
      const where = path.length ? path.join(" / ") : "(top level)";
      const label = entry.action || entry.keys.join(" / ") || "(empty)";
      if (!entry.keys.length) errors.push(`"${label}" in ${where}: missing keys`);
      if (!entry.action) errors.push(`${entry.keys.join(" / ") || "a shortcut"} in ${where}: missing action`);
      if (!path.length) warnings.push({ message: `"${label}" is not under any heading` });
      for (const k of entry.keys) {
        const id = path.slice(0, 2).join("/") + "\u0000" + entry.version + "\u0000" + k;
        if (seen.has(id)) warnings.push({ message: `${k} is used twice in ${path.slice(0, 2).join(" / ") || "(top level)"} ("${seen.get(id)}" and "${label}")` });
        else seen.set(id, label);
      }
    }
    return { model, errors, warnings: warnings.map((w) => (w.line ? `line ${w.line}: ${w.message}` : w.message)) };
  }

  return {
    parse, serialize, serializeEntry, emptyModel, newFolder, parseTags, cleanTag, cleanFolderName, splitPath,
    parseKeys, normalizeCombo, canonicalKey, formatCombo, osKind, kindOf, context, MODIFIERS, KEY_ALIASES,
    findFolder, allEntries, allFolders, locate, countEntries, tagCounts, conflicts,
    addEntry, updateEntry, toggleFavorite, deleteEntry, addFolder, setFolderVersion, renameFolder, moveFolder, deleteFolder,
    validate, MAX_DEPTH,
  };
});
