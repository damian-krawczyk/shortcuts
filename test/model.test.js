"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const M = require("../src/model.js");

const example = fs.readFileSync(path.join(__dirname, "../examples/shortcuts.md"), "utf8");

test("round-trips the example file exactly", () => {
  assert.equal(M.serialize(M.parse(example).model), example);
});

test("parses OS, software, sections, versions, favorites, keys and tags", () => {
  const { model, warnings } = M.parse(example);
  assert.deepEqual(warnings, []);
  assert.equal(model.title, "Example shortcuts");
  const mac = M.findFolder(model, ["macOS"]);
  assert.equal(mac.version, "15 Sequoia");
  assert.equal(mac.entries[0].action, "Spotlight");
  assert.equal(mac.entries[0].favorite, true);
  assert.equal(mac.entries[0].description, "search apps, files and the web");
  assert.equal(mac.entries[1].favorite, false);
  assert.equal(mac.entries[1].description, "saved to the desktop\nAdd Ctrl to copy it to the clipboard\ninstead of saving a file.");
  const code = M.findFolder(model, ["macOS", "VS Code"]);
  assert.equal(code.version, "1.95");
  assert.deepEqual(code.entries[0].keys, ["Shift+Cmd+P", "F1"]);
  assert.deepEqual(code.entries[0].tags, ["essential"]);
  assert.equal(code.entries[1].version, "1.90+");
  assert.deepEqual(code.entries[1].keys, ["Cmd+K Cmd+S"]);
  const editing = M.findFolder(model, ["macOS", "VS Code", "Editing"]);
  assert.equal(editing.entries[2].action, "Move line up / down");
});

test("normalizes key names, modifier order, chords and alternatives", () => {
  assert.equal(M.normalizeCombo("cmd+shift+p"), "Shift+Cmd+P");
  assert.equal(M.normalizeCombo("⌘⇧p".split("").join("+")), "Shift+Cmd+P");
  assert.equal(M.normalizeCombo("control+option+del"), "Ctrl+Alt+Delete");
  assert.equal(M.normalizeCombo("shift+win+s"), "Win+Shift+S");
  assert.equal(M.normalizeCombo("cmd+k   cmd+s"), "Cmd+K Cmd+S");
  assert.equal(M.normalizeCombo("cmd++"), "Cmd+Plus");
  assert.equal(M.normalizeCombo("Cmd+,"), "Cmd+,");
  assert.equal(M.normalizeCombo("shift shift"), "Shift Shift");
  assert.equal(M.normalizeCombo("f12"), "F12");
  assert.deepEqual(M.parseKeys("cmd+d / Cmd+D / ctrl+/"), ["Cmd+D", "Ctrl+/"]);
  assert.deepEqual(M.parseKeys(["`Cmd+P`", ""]), ["Cmd+P"]);
});

test("formats keys with each OS's symbols", () => {
  assert.deepEqual(M.formatCombo("Shift+Cmd+P", "mac"), [["⇧", "⌘", "P"]]);
  assert.deepEqual(M.formatCombo("Ctrl+K Ctrl+Up", "win"), [["Ctrl", "K"], ["Ctrl", "↑"]]);
  assert.equal(M.osKind("macOS"), "mac");
  assert.equal(M.osKind("Windows 11"), "win");
  assert.equal(M.osKind("Ubuntu"), "linux");
});

test("normalizes loose input into the canonical form", () => {
  const messy = "# Mac\nversion:  14 \n* `cmd+c` Copy - to clipboard\n    tags: a, #b\n    VERSION: 2\n- [X] `cmd+v` Paste\n### Deep\n- [ ] `x` y\n# Mac\n- `cmd+z` Undo\n";
  const { model, warnings } = M.parse(messy);
  assert.equal(warnings.length, 2); // skipped level, duplicate folder merged
  assert.equal(M.serialize(model),
    "# Mac\nversion: 14\n\n- [ ] `Cmd+C` Copy — to clipboard\n  tags: #a #b\n  version: 2\n- [x] `Cmd+V` Paste\n- [ ] `Cmd+Z` Undo\n\n## Deep\n\n- [ ] `X` y\n");
});

test("reads YAML front matter, keeps other keys, and upgrades the old title comment", () => {
  const md = "---\ntitle: \"Keys: mine\"\nauthor: me\n---\n\n# A\n\n- [ ] `X` x\n";
  const { model, warnings } = M.parse(md);
  assert.deepEqual(warnings, []);
  assert.equal(model.title, "Keys: mine");
  assert.deepEqual(model.front, ["author: me"]);
  assert.equal(M.serialize(model), md);
  assert.equal(M.parse("---\ntitle: 'It''s mine'\n---\n").model.title, "It's mine");
  const old = M.parse("<!-- title: Old -->\n\n# A\n");
  assert.equal(old.model.title, "Old");
  assert.equal(M.serialize(old.model), "---\ntitle: Old\n---\n\n# A\n");
  const model2 = M.emptyModel("123");
  assert.equal(M.serialize(model2), "---\ntitle: \"123\"\n---\n");
  assert.equal(M.parse("# A\n\n---\n").warnings.length, 1); // a later --- is just a note
});

test("keeps unknown lines as notes", () => {
  const withNote = "# F\n\nSome free text\n- [ ] `A` a\n";
  const p = M.parse(withNote);
  assert.equal(p.warnings.length, 1);
  assert.equal(M.serialize(p.model), "# F\n\nSome free text\n\n- [ ] `A` a\n");
});

test("versions: the shortcut's own version overrides the deepest folder version", () => {
  const { model } = M.parse(example);
  const all = M.allEntries(model);
  const ks = all.find((x) => x.entry.action === "Keyboard Shortcuts editor");
  const ctx = M.context(model, ks.path, ks.entry);
  assert.deepEqual(ctx.levels, [{ name: "macOS", version: "15 Sequoia" }, { name: "VS Code", version: "1.90+" }]);
  assert.equal(ctx.version, "1.95");
  assert.equal(ctx.kind, "mac");
  const move = all.find((x) => x.entry.action === "Move line up / down");
  assert.deepEqual(M.context(model, move.path, move.entry).levels.map((l) => l.version), ["15 Sequoia", "1.95", ""]);
  const spot = all.find((x) => x.entry.action === "Spotlight");
  assert.deepEqual(M.context(model, spot.path, spot.entry).levels, [{ name: "macOS", version: "15 Sequoia" }]);
  M.setFolderVersion(model, ["macOS"], " 26 ");
  assert.equal(M.findFolder(model, ["macOS"]).version, "26");
});

test("key symbols follow an OS name at any level", () => {
  assert.equal(M.kindOf(["VS Code", "macOS"]), "mac");
  assert.equal(M.kindOf(["Work", "Windows 11", "Excel"]), "win");
  assert.equal(M.kindOf(["Vim"]), "linux");
});

test("add, update, favorite, move and delete entries", () => {
  const { model } = M.parse(example);
  const e = M.addEntry(model, ["macOS", "Safari"], { keys: "cmd+l", action: " Focus  address bar ", tags: "#x, y x" });
  assert.equal(e.action, "Focus address bar");
  assert.deepEqual(e.keys, ["Cmd+L"]);
  assert.deepEqual(e.tags, ["x", "y"]);
  assert.equal(e.favorite, false);
  M.toggleFavorite(model, e.id);
  assert.equal(M.locate(model, e.id).entry.favorite, true);
  assert.match(M.serialize(model), /- \[x\] `Cmd\+L` Focus address bar\n  tags: #x #y\n/);
  M.updateEntry(model, e.id, { description: "d", version: "18" }, ["macOS", "Finder"]);
  assert.equal(M.locate(model, e.id).path.join("/"), "macOS/Finder");
  assert.equal(M.locate(model, e.id).entry.version, "18");
  assert.equal(M.locate(model, e.id).entry.favorite, true);
  assert.ok(M.deleteEntry(model, e.id));
  assert.equal(M.locate(model, e.id), null);
});

test("finds conflicting keys within the same OS and software", () => {
  const { model } = M.parse(example);
  assert.equal(M.conflicts(model, ["macOS", "VS Code", "Other"], ["F1"]).length, 1);
  assert.equal(M.conflicts(model, ["Windows", "VS Code"], ["Cmd+D"]).length, 0);
});

test("folder rename merges, move refuses cycles, delete removes contents", () => {
  const { model } = M.parse(example);
  const before = M.allEntries(model).length;
  M.renameFolder(model, ["macOS", "Finder"], "VS Code");
  assert.equal(M.findFolder(model, ["macOS", "Finder"]), null);
  assert.equal(M.allEntries(model).length, before);
  assert.equal(M.moveFolder(model, ["macOS"], ["macOS", "VS Code"]), null);
  M.moveFolder(model, ["Linux", "Vim"], ["macOS"]);
  assert.ok(M.findFolder(model, ["macOS", "Vim"]));
  M.deleteFolder(model, ["macOS"]);
  assert.equal(M.findFolder(model, ["macOS"]), null);
});

test("refuses folders deeper than Markdown headings allow", () => {
  const model = M.emptyModel();
  M.addFolder(model, ["1", "2", "3", "4", "5", "6"]);
  assert.throws(() => M.addFolder(model, ["1", "2", "3", "4", "5", "6", "7"]));
  M.addFolder(model, ["a", "b"]);
  assert.throws(() => M.moveFolder(model, ["a"], ["1", "2", "3", "4", "5"]));
});

test("validate reports missing keys or actions and duplicate keys", () => {
  const { errors, warnings } = M.validate("- [ ] `A` loose\n# Mac\n## App\n- [ ] `Cmd+A` Select all\n- [ ] `cmd+a` Again\n- [ ] Nothing\n- [ ] `Cmd+B`\n");
  assert.equal(errors.length, 1); // `Cmd+B` has no action; "Nothing" has no keys, so it's a note
  assert.ok(warnings.some((w) => /not under any heading/.test(w)));
  assert.ok(warnings.some((w) => /Cmd\+A is used twice in Mac \/ App/.test(w)));
  assert.ok(warnings.some((w) => /kept as a note/.test(w)));
});
