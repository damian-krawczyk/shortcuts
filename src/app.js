// The page: level filters, folder tree, tag cloud, shortcut cards, favorites,
// search and the editor (with a key recorder). Data comes inlined (window.SHORTCUTS_DATA).
// Under `shortcuts serve`, edits are saved by sending the whole re-serialized Markdown back.
(function () {
  "use strict";

  const Model = window.ShortcutsModel;
  const DATA = window.SHORTCUTS_DATA;
  const config = DATA.config || {};
  const readOnly = !!config.readOnly;
  const i18n = window.I18n.create(DATA.locales, "en");
  const t = i18n.t;
  const $ = (sel) => document.querySelector(sel);

  // ---- per-browser preferences (may be unavailable, e.g. private mode) ----
  const store = {
    get(k, d) { try { const v = localStorage.getItem("sc-" + k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem("sc-" + k, JSON.stringify(v)); } catch (_) { /* ignore */ } },
  };
  // The theme is stored as a bare string so the inline <head> script can read it.
  const themeStore = {
    get() { try { return localStorage.getItem("sc-theme") || "auto"; } catch (_) { return "auto"; } },
    set(v) { try { localStorage.setItem("sc-theme", v); } catch (_) { /* ignore */ } },
  };

  const state = {
    model: Model.parse(DATA.markdown).model,
    version: config.version || null,
    folder: store.get("folder", null), // folder selected in the tree, null = everything
    levels: store.get("levels", []), // per heading level: a folder name, NONE, or null (= any)
    favOnly: store.get("favOnly", false),
    query: "",
    collapsed: new Set(store.get("collapsed", [])),
    theme: themeStore.get(),
    editing: null, // { id, sig } of the entry in the editor, or null for a new one
  };

  // ---- text helpers ----
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const foldChar = (c) => c.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace("ł", "l");
  const fold = (s) => [...String(s ?? "")].map(foldChar).join("");

  // Wrap the parts of `text` that match any term (accent- and case-insensitive) in <mark>.
  function highlight(text, terms) {
    text = String(text ?? "");
    if (!terms.length || !text) return esc(text);
    let folded = "";
    const map = []; // index in folded → index in text
    let i = 0;
    for (const ch of text) {
      const f = foldChar(ch);
      for (let k = 0; k < f.length; k++) map.push(i);
      folded += f;
      i += ch.length;
    }
    map.push(text.length);
    const marks = new Array(text.length + 1).fill(0);
    for (const term of terms) {
      if (!term) continue;
      let at = folded.indexOf(term);
      while (at >= 0) {
        marks[map[at]]++;
        marks[map[at + term.length]]--;
        at = folded.indexOf(term, at + term.length);
      }
    }
    let out = "", depth = 0, open = false;
    for (let j = 0; j < text.length; j++) {
      depth += marks[j];
      if (depth > 0 && !open) { out += "<mark>"; open = true; }
      if (depth <= 0 && open) { out += "</mark>"; open = false; }
      out += esc(text[j]);
    }
    return out + (open ? "</mark>" : "");
  }

  const pathKey = (p) => (p || []).join("/");
  const samePath = (a, b) => pathKey(a) === pathKey(b);
  const within = (path, folder) => !folder || !folder.length || pathKey(path) === pathKey(folder) || pathKey(path).startsWith(pathKey(folder) + "/");
  // ---- level filters ----
  // One dropdown per heading level. Level n picks folders of that name at depth n in any branch,
  // so "Level 2 = VS Code" finds VS Code under every level-1 heading. Levels mean whatever the
  // file says they mean. NONE picks shortcuts that sit directly in the level above.
  const NONE = "/"; // "/" is never part of a folder name

  function matchesLevels(path, upto = state.levels.length) {
    for (let i = 0; i < upto; i++) {
      const lv = state.levels[i];
      if (lv == null) continue;
      if (lv === NONE ? path.length !== i : path[i] !== lv) return false;
    }
    return true;
  }

  // Can this folder hold shortcuts that pass the level filters?
  const folderAllowed = (path) => path.every((name, i) => state.levels[i] == null || state.levels[i] === name);

  // The names found at level i among shortcuts that pass levels 1..i, with counts.
  function levelOptions(i) {
    const names = new Map();
    let none = 0;
    for (const { path } of Model.allEntries(state.model)) {
      if (!matchesLevels(path, i)) continue;
      if (path.length > i) names.set(path[i], (names.get(path[i]) || 0) + 1);
      else if (path.length === i) none++;
    }
    return { names: [...names.entries()], none };
  }

  // Levels that get a dropdown: every depth that has folders, stopping after a NONE choice.
  function shownLevels() {
    const out = [];
    for (let i = 0; i < Model.MAX_DEPTH; i++) {
      const opts = levelOptions(i);
      if (!opts.names.length && state.levels[i] == null) break;
      out.push(Object.assign({ index: i }, opts));
      if (state.levels[i] === NONE) break;
    }
    return out;
  }

  function fixSelection() {
    const lv = state.levels;
    for (let i = 0; i < lv.length; i++) {
      if (lv[i] == null) continue;
      const { names, none } = levelOptions(i);
      if (lv[i] === NONE ? !none : !names.some(([n]) => n === lv[i])) lv[i] = null;
    }
    while (lv.length && lv[lv.length - 1] == null) lv.pop();
    if (state.folder && (!Model.findFolder(state.model, state.folder) || !folderAllowed(state.folder))) state.folder = null;
  }
  fixSelection();

  // ---- keys ----
  // Draw a shortcut's combos as <kbd> keys, with the symbols of the OS it belongs to.
  function keysHtml(keys, kind) {
    return keys.map((combo) => `<span class="combo">${Model.formatCombo(combo, kind)
      .map((step) => `<span class="step">${step.map((k) => `<kbd>${esc(k)}</kbd>`).join("")}</span>`)
      .join(`<span class="then">${esc(t("keys.then"))}</span>`)}</span>`)
      .join(`<span class="or">${esc(t("keys.or"))}</span>`);
  }

  // Words a combo can be found by: "shift cmd p ⇧⌘p".
  function keyWords(keys, kind) {
    return keys.map((c) => c.toLowerCase().replace(/\+/g, " ") + " " + Model.formatCombo(c, kind).map((s) => s.join("")).join(" ")).join(" ");
  }

  // ---- search ----
  // "#tag" tags, "is:fav" favorites, "in:name" folders (any level); other words must all match. Key names
  // match their aliases too ("command", "⌘" and "cmd" are the same); "cmd+p" is two words.
  function parseQuery(q) {
    const tags = [], words = [], folders = [];
    let fav = false;
    for (const raw of q.trim().split(/\s+/).filter(Boolean)) {
      let m;
      if (raw.startsWith("#") && raw.length > 1) tags.push(fold(raw.slice(1)));
      else if (/^is:fav/i.test(raw)) fav = true;
      else if ((m = /^in:(.+)$/i.exec(raw))) folders.push(fold(m[1]));
      else {
        const pieces = raw.length > 1 && raw.includes("+") ? raw.split("+").filter(Boolean) : [raw];
        for (const p of pieces) {
          const alias = Model.KEY_ALIASES[p.toLowerCase()];
          words.push({ term: fold(p), alts: [fold(p)].concat(alias ? [alias.toLowerCase()] : []) });
        }
      }
    }
    return { tags, words, folders, fav };
  }

  function startsWord(hay, a) {
    for (let i = hay.indexOf(a); i >= 0; i = hay.indexOf(a, i + 1)) if (i === 0 || !/[\p{L}\p{N}]/u.test(hay[i - 1])) return true;
    return false;
  }

  function filtered() {
    const { tags, words, folders, fav } = parseQuery(state.query);
    return Model.allEntries(state.model).filter(({ entry, path }) => {
      if (!within(path, state.folder)) return false;
      if (!matchesLevels(path)) return false;
      if ((fav || state.favOnly) && !entry.favorite) return false;
      if (folders.length) {
        const names = path.map(fold);
        if (!folders.every((f) => names.some((n) => n.includes(f)))) return false;
      }
      const etags = entry.tags.map(fold);
      if (!tags.every((tg) => etags.some((x) => x === tg || x.startsWith(tg)))) return false;
      if (!words.length) return true;
      const kind = Model.kindOf(path);
      const keyHay = keyWords(entry.keys, kind);
      const hay = fold([entry.action, entry.description, entry.tags.join(" "), path.join(" "), entry.version, keyHay].join(" \u0000 "));
      // One character ("p") matches a key, or the start of a word, not any word containing it.
      const keySet = new Set(fold(keyHay).split(/\s+/).concat(...entry.keys.map((c) => Model.formatCombo(c, kind).flat().map(fold))));
      return words.every((w) => w.alts.some((a) => (a.length === 1 ? keySet.has(a) || startsWord(hay, a) : hay.includes(a))));
    });
  }

  // ---- rendering ----
  function render() {
    document.body.classList.toggle("readonly", readOnly);
    fixSelection();
    const title = state.model.title || t("app.title");
    $("#title").textContent = title;
    document.title = title;
    renderFilters();
    renderTree();
    renderTags();
    const shown = filtered();
    renderCrumbs(shown);
    renderFavButton();
    renderList(shown);
    const depth = (state.folder || []).length;
    $("#new-folder").textContent = "+ " + t(depth ? "action.newSubfolder" : "action.newFolder");
    $("#new-folder").hidden = depth >= Model.MAX_DEPTH;
  }

  function renderFilters() {
    const levels = shownLevels();
    const box = $("#filters");
    box.hidden = !levels.length;
    box.innerHTML = levels.map(({ index, names, none }) => {
      const n = index + 1;
      const opt = (value, label, count) => `<option value="${esc(value)}">${esc(label)} (${count})</option>`;
      const opts = [`<option value="">${esc(t("filter.level.all"))}</option>`]
        .concat(names.map(([name, c]) => opt(name, name, c)))
        .concat(none && names.length ? [opt(NONE, index ? t("filter.level.none", { prev: index }) : t("filter.level.noneTop"), none)] : []);
      return `<label><span>${esc(t("filter.level", { n }))}</span><select data-level="${index}">${opts.join("")}</select></label>`;
    }).join("");
    box.querySelectorAll("select").forEach((sel) => { sel.value = state.levels[sel.dataset.level] ?? ""; });
  }

  function setLevel(i, value) {
    state.levels[i] = value === "" ? null : value;
    state.levels.length = Math.max(state.levels.length, i + 1);
    for (let k = 0; k < state.levels.length; k++) if (state.levels[k] === undefined) state.levels[k] = null;
    fixSelection();
    store.set("levels", state.levels);
    store.set("folder", state.folder);
    render();
  }

  function renderFavButton() {
    $("#fav-count").textContent = Model.allEntries(state.model)
      .filter(({ entry, path }) => entry.favorite && within(path, state.folder) && matchesLevels(path)).length;
    $("#fav-btn").setAttribute("aria-pressed", state.favOnly);
  }

  function renderCrumbs(shown) {
    const parts = [`<button data-path="">${esc(t("tree.all"))}</button>`];
    const folder = state.folder || [];
    for (let i = 0; i < folder.length; i++) {
      parts.push(`<span class="sep">/</span><button data-path="${esc(pathKey(folder.slice(0, i + 1)))}">${esc(folder[i])}</button>`);
    }
    $("#crumbs").innerHTML = parts.join("");
    const total = Model.allEntries(state.model).filter(({ path }) => within(path, state.folder) && matchesLevels(path)).length;
    $("#count").textContent = shown.length === total
      ? t("count.shortcuts", { count: total })
      : t("count.shown", { shown: shown.length, total: t("count.shortcuts", { count: total }) });
  }

  function renderTree() {
    const row = (path, name, folder, hasKids) => {
      const key = pathKey(path);
      const open = !state.collapsed.has(key);
      const isBase = !path.length;
      const sel = isBase ? !state.folder : !!state.folder && samePath(path, state.folder);
      const btn = (act, label, icon) => `<button data-act="${act}" title="${esc(label)}" aria-label="${esc(label)}">${icon}</button>`;
      const sub = t(path.length ? "action.newSubfolder" : "action.newFolder");
      const acts = readOnly ? "" : `<span class="acts">
          ${path.length < Model.MAX_DEPTH ? btn("sub", sub, "+") : ""}
          ${path.length ? btn("version", t("action.setVersion"), "v") + btn("rename", t("action.rename"), "✎") + btn("delete", t("action.deleteFolder"), "🗑") : ""}
        </span>`;
      const ver = folder.version && !isBase ? `<span class="ver">${esc(folder.version)}</span>` : "";
      return `<div class="tree-row${sel ? " selected" : ""}" data-path="${esc(key)}" tabindex="0" role="treeitem"
          ${hasKids ? `aria-expanded="${open}"` : ""} ${!readOnly && path.length && !isBase ? 'draggable="true"' : ""}>
        <button class="chev${hasKids ? (open ? " open" : "") : " none"}" data-act="toggle" tabindex="-1" aria-hidden="true">▶</button>
        <span class="name">${esc(name)}${ver}</span><span class="cnt">${Model.countEntries(folder)}</span>${acts}</div>`;
    };
    // With level filters on, only folders holding shortcuts that pass them.
    const filtering = state.levels.some((l) => l != null);
    const hits = filtering ? Model.allEntries(state.model).filter(({ path }) => matchesLevels(path)).map(({ path }) => path) : [];
    const kids = (folder, path) => folder.folders.filter((f) => {
      const p = path.concat(f.name);
      return !filtering || (folderAllowed(p) && hits.some((h) => within(h, p)));
    });
    const walk = (folder, path) => {
      if (!kids(folder, path).length) return "";
      return "<ul role=\"group\">" + kids(folder, path).map((f) => {
        const p = path.concat(f.name);
        const open = !state.collapsed.has(pathKey(p));
        return `<li>${row(p, f.name, f, kids(f, p).length > 0)}${open ? walk(f, p) : ""}</li>`;
      }).join("") + "</ul>";
    };
    $("#tree").innerHTML = `<ul role="tree"><li>${row([], t("tree.all"), state.model.root, false)}</li></ul>${walk(state.model.root, [])}`;
  }

  function renderTags() {
    const counts = Model.tagCounts(state.model);
    const active = new Set(parseQuery(state.query).tags);
    $("#tags").innerHTML = counts.length
      ? counts.map(([tag, n]) => `<button class="tag${active.has(fold(tag)) ? " active" : ""}" data-tag="${esc(tag)}">#${esc(tag)} <span class="n">${n}</span></button>`).join("")
      : `<span class="empty-note">${esc(t("tree.noTags"))}</span>`;
  }

  function renderList(shown) {
    const { tags, words } = parseQuery(state.query);
    const terms = words.map((w) => w.term);
    const list = $("#list");
    if (!shown.length) {
      const msg = state.query ? t("list.noMatches", { query: state.query }) : state.favOnly ? t("list.noFavorites") : t("list.empty");
      list.innerHTML = `<div class="list-empty">${esc(msg)}</div>`;
      return;
    }
    list.innerHTML = shown.map(({ entry, path }) => {
      const ctx = Model.context(state.model, path, entry);
      const tagHtml = entry.tags.map((tg) => {
        const on = tags.some((x) => fold(tg).startsWith(x));
        return `<button class="tag${on ? " active" : ""}" data-tag="${esc(tg)}">#${highlight(tg, terms)}</button>`;
      }).join("");
      const part = ({ name, version }) => `${highlight(name, terms)}${version ? ` <span class="v">${highlight(version, terms)}</span>` : ""}`;
      const where = path.length ? `<button class="ctx" data-path="${esc(pathKey(path))}">${ctx.levels.map(part).join(" · ")}</button>` : "";
      const favLabel = esc(t("action.toggleFavorite"));
      const star = readOnly
        ? (entry.favorite ? `<span class="star on" title="${esc(t("field.favorite"))}">★</span>` : "")
        : `<button class="star${entry.favorite ? " on" : ""}" data-act="fav" data-id="${entry.id}" aria-pressed="${entry.favorite}" title="${favLabel}" aria-label="${favLabel}">★</button>`;
      const tools = readOnly ? "" : `<div class="tools">
          <button data-act="edit" data-id="${entry.id}">${esc(t("action.edit"))}</button>
          <button data-act="delete" data-id="${entry.id}" class="danger" aria-label="${esc(t("action.delete"))}">✕</button></div>`;
      return `<article class="card" data-id="${entry.id}" ${readOnly ? "" : 'draggable="true"'}>
        <div class="head"><div class="combos">${keysHtml(entry.keys, ctx.kind)}</div>${star}</div>
        <div class="action">${highlight(entry.action, terms)}</div>
        ${entry.description ? `<div class="desc">${highlight(entry.description, terms)}</div>` : ""}
        ${tagHtml || where ? `<div class="meta">${where}${tagHtml}</div>` : ""}
        ${tools}
      </article>`;
    }).join("");
  }

  // ---- actions ----
  function selectFolder(path) {
    path = path && path.length ? path : null;
    // Drop level filters that would hide the chosen folder.
    (path || []).forEach((name, i) => { if (state.levels[i] != null && state.levels[i] !== name) state.levels[i] = null; });
    state.folder = path;
    fixSelection();
    store.set("levels", state.levels);
    store.set("folder", state.folder);
    // Open the ancestors so the selection is visible in the tree.
    (path || []).forEach((_, i) => state.collapsed.delete(pathKey(path.slice(0, i))));
    store.set("collapsed", [...state.collapsed]);
    document.body.classList.remove("side-open");
    render();
  }

  function setQuery(q) {
    state.query = q;
    $("#search").value = q;
    render();
  }

  function toggleTag(tag) {
    const { tags } = parseQuery(state.query);
    const f = fold(tag);
    const parts = state.query.trim().split(/\s+/).filter(Boolean);
    const next = tags.includes(f) ? parts.filter((p) => !(p.startsWith("#") && fold(p.slice(1)) === f)) : parts.concat("#" + tag);
    setQuery(next.join(" ") + (next.length ? " " : ""));
  }

  function toggleFavOnly() {
    state.favOnly = !state.favOnly;
    store.set("favOnly", state.favOnly);
    render();
  }

  const THEMES = ["auto", "light", "dark"];
  function applyTheme() {
    if (state.theme === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = state.theme;
    const icon = { auto: "◐", light: "☀", dark: "☾" }[state.theme];
    const btn = $("#theme-btn");
    btn.textContent = icon;
    btn.title = t("theme." + state.theme);
    btn.setAttribute("aria-label", t("theme." + state.theme));
  }

  // "Built 7 Nov 2026, 15:24 · commit a901fb6" in the sidebar footer.
  function renderBuildInfo() {
    const b = config.build || {};
    const parts = [];
    const when = b.time ? new Date(b.time) : null;
    if (when && !isNaN(when)) {
      let text;
      try { text = new Intl.DateTimeFormat(i18n.lang, { dateStyle: "medium", timeStyle: "short" }).format(when); } catch (_) { text = when.toLocaleString(); }
      parts.push(esc(t("footer.built", { date: text })));
    }
    if (b.commit) {
      const hashHtml = b.commitUrl && /^https:\/\//.test(b.commitUrl)
        ? `<a href="${esc(b.commitUrl)}" target="_blank" rel="noopener noreferrer">${esc(b.commit)}</a>`
        : `<code>${esc(b.commit)}</code>`;
      parts.push(`${esc(t("footer.commit"))} ${hashHtml}`);
    }
    $("#build-info").innerHTML = parts.join(" · ");
  }

  function applyLanguage() {
    document.documentElement.lang = i18n.lang;
    i18n.apply(document);
    applyTheme();
    renderBuildInfo();
    render();
  }

  let toastTimer = null;
  function toast(msg, isError) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.toggle("error", !!isError);
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), isError ? 5000 : 1800);
  }

  // ---- saving (serve mode) ----
  const api = (path, opts = {}) => fetch(path, Object.assign({}, opts, { headers: Object.assign({ "X-Shortcuts": "1" }, opts.headers || {}) }));

  async function reload() {
    const res = await api("/api/shortcuts", { cache: "no-store" });
    if (!res.ok) throw new Error(res.statusText);
    state.version = res.headers.get("ETag");
    state.model = Model.parse(await res.text()).model;
    render();
  }

  let saving = Promise.resolve();
  // Apply `change` to the model, then write the file. On failure, reload what's on disk.
  function commit(change) {
    if (readOnly) return Promise.resolve(false);
    try { change(state.model); } catch (e) { toast(e.message, true); return Promise.resolve(false); }
    render();
    const text = Model.serialize(state.model);
    saving = saving.then(async () => {
      try {
        const res = await api("/api/shortcuts", {
          method: "PUT",
          headers: Object.assign({ "Content-Type": "text/markdown; charset=utf-8" }, state.version ? { "If-Match": state.version } : {}),
          body: text,
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok) { state.version = body.version; toast(t("status.saved")); return true; }
        if (res.status === 409) { await reload(); toast(t("error.conflict"), true); return false; }
        await reload();
        toast(t("error.save", { message: body.error || res.statusText }), true);
        return false;
      } catch (_) {
        toast(t("error.offline"), true);
        return false;
      }
    });
    return saving;
  }

  // Live updates: the file changed on disk, or another tab saved.
  function listen() {
    if (readOnly || !window.EventSource) return;
    const es = new EventSource("/events");
    es.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (msg.version && msg.version !== state.version) {
        // Saves are serialized; wait for ours so we don't treat our own write as foreign.
        saving.then(() => { if (msg.version !== state.version) reload().catch(() => {}); });
      }
    };
  }

  // ---- editor ----
  const form = $("#editor-form");
  const dialog = $("#editor");
  const keysList = $("#keys-list");
  // After a reload ids change, so the editor also remembers the entry by its keys and action.
  const sigOf = (e) => e.keys.join("|") + "\u0000" + e.action;

  const editorPath = () => Model.splitPath(form.folder.value);
  const editorKind = () => {
    const path = editorPath();
    if (path.length) return Model.kindOf(path);
    return /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent) ? "mac" : /win/i.test(navigator.platform || "") ? "win" : "linux";
  };

  // Where a new shortcut goes: the selected folder, extended by level filters that continue it.
  function presetPath() {
    const path = (state.folder || []).slice();
    while (path.length < Model.MAX_DEPTH && state.levels[path.length] && state.levels[path.length] !== NONE) path.push(state.levels[path.length]);
    return path;
  }

  function folderOptions() {
    $("#folder-list").innerHTML = Model.allFolders(state.model).map(({ path }) => `<option value="${esc(path.join("/"))}">`).join("");
  }

  function comboRow(value) {
    const row = document.createElement("div");
    row.className = "combo-row";
    row.innerHTML = `<div class="row">
        <input class="combo-input" autocomplete="off" spellcheck="false" placeholder="Cmd+Shift+P">
        <button type="button" class="rec small" data-act="rec">● ${esc(t("field.record"))}</button>
        <button type="button" class="ghost small" data-act="remove" title="${esc(t("field.removeCombo"))}" aria-label="${esc(t("field.removeCombo"))}">✕</button>
      </div>
      <div class="preview"></div>`;
    row.querySelector("input").value = value || "";
    keysList.appendChild(row);
    return row;
  }

  const comboInputs = () => [...keysList.querySelectorAll(".combo-input")];
  const editorKeys = () => Model.parseKeys(comboInputs().map((i) => i.value));

  function updatePreviews() {
    const kind = editorKind();
    for (const input of comboInputs()) {
      const combo = Model.normalizeCombo(input.value);
      input.closest(".combo-row").querySelector(".preview").innerHTML = combo ? keysHtml([combo], kind) : "";
    }
    const removable = comboInputs().length > 1;
    keysList.querySelectorAll('[data-act="remove"]').forEach((b) => { b.hidden = !removable; });
  }

  function openEditor(entry) {
    if (readOnly) return;
    stopRecording();
    const loc = entry && Model.locate(state.model, entry.id);
    state.editing = loc ? { id: entry.id, sig: sigOf(entry) } : null;
    $("#editor-title").textContent = t(loc ? "dialog.edit" : "dialog.add");
    keysList.innerHTML = "";
    for (const k of loc && entry.keys.length ? entry.keys : [""]) comboRow(k);
    form.what.value = loc ? entry.action : "";
    form.description.value = loc ? entry.description : "";
    form.tags.value = loc ? entry.tags.join(" ") : "";
    form.version.value = loc ? entry.version : "";
    form.favorite.checked = loc ? entry.favorite : state.favOnly;
    form.folder.value = pathKey(loc ? loc.path : presetPath());
    $("#editor-delete").hidden = !loc;
    $("#editor-error").textContent = "";
    folderOptions();
    editorChanged();
    suggestTags();
    if (!dialog.open) dialog.showModal();
    (comboInputs()[0].value ? form.what : comboInputs()[0]).focus();
  }

  // Keys already used under the same first two levels; the inherited version as the version hint.
  function editorChanged() {
    updatePreviews();
    const path = editorPath();
    const keys = editorKeys();
    const hits = keys.length && path.length ? Model.conflicts(state.model, path, keys, state.editing && state.editing.id) : [];
    $("#keys-note").textContent = hits.map(({ entry }) => {
      const k = entry.keys.find((x) => keys.includes(x));
      return t("status.duplicate", { keys: k, action: entry.action });
    }).join(" · ");
    const inherited = Model.context(state.model, path, null).version;
    $("#version-hint").textContent = inherited ? t("field.versionHint", { version: inherited }) : t("field.versionHintNone");
  }

  // ---- key recorder: click Record, press the keys (several presses make a chord) ----
  let rec = null; // { input, button, timer }
  const MOD_KEYS = ["Shift", "Control", "Alt", "Meta", "OS", "AltGraph", "CapsLock", "Fn", "FnLock", "Hyper", "Super"];
  const CODE_KEYS = {
    Slash: "/", Period: ".", Comma: ",", Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]",
    Backslash: "\\", Minus: "-", Equal: "=", Backquote: "Backtick", Space: "Space", IntlBackslash: "§",
  };
  const NAMED_KEYS = { " ": "Space", Escape: "Esc", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right" };

  function stepFromEvent(ev) {
    if (MOD_KEYS.includes(ev.key)) return "";
    const code = ev.code || "";
    let key;
    if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
    else if (/^Digit\d$/.test(code)) key = code.slice(5);
    else if (/^Numpad\d$/.test(code)) key = "Num" + code.slice(6);
    else key = CODE_KEYS[code] || NAMED_KEYS[ev.key] || ev.key;
    if (!key || key === "Unidentified" || key === "Dead") return "";
    const kind = editorKind();
    const mods = [];
    if (ev.ctrlKey) mods.push("Ctrl");
    if (ev.altKey) mods.push("Alt");
    if (ev.shiftKey) mods.push("Shift");
    if (ev.metaKey) mods.push(kind === "mac" ? "Cmd" : kind === "win" ? "Win" : "Super");
    return Model.normalizeCombo(mods.concat(key === "+" ? "Plus" : key).join("+"));
  }

  function startRecording(row) {
    stopRecording();
    const input = row.querySelector("input"), button = row.querySelector('[data-act="rec"]');
    rec = { input, button, timer: null };
    input.value = "";
    button.classList.add("on");
    button.textContent = "● " + t("field.recording");
    updatePreviews();
  }

  function stopRecording() {
    if (!rec) return;
    clearTimeout(rec.timer);
    rec.button.classList.remove("on");
    rec.button.textContent = "● " + t("field.record");
    rec = null;
    editorChanged();
  }

  // Capture phase, so Esc, Tab or the page's own keys are recorded instead of acting.
  document.addEventListener("keydown", (ev) => {
    if (!rec) return;
    ev.preventDefault();
    ev.stopPropagation();
    const step = stepFromEvent(ev);
    if (!step) return;
    rec.input.value = (rec.input.value ? rec.input.value + " " : "") + step;
    updatePreviews();
    clearTimeout(rec.timer);
    rec.timer = setTimeout(stopRecording, 1500);
  }, true);
  dialog.addEventListener("cancel", (ev) => { if (rec) ev.preventDefault(); });

  keysList.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-act]");
    if (!b) return;
    const row = b.closest(".combo-row");
    if (b.dataset.act === "rec") { if (rec && rec.button === b) stopRecording(); else startRecording(row); }
    else if (b.dataset.act === "remove") { if (rec && row.contains(rec.button)) stopRecording(); row.remove(); editorChanged(); }
  });
  keysList.addEventListener("input", editorChanged);
  $("#add-combo").addEventListener("click", () => { comboRow("").querySelector("input").focus(); updatePreviews(); });

  function suggestTags() {
    const val = form.tags.value;
    const current = Model.parseTags(val);
    const last = /[\s,]$/.test(val) || !val ? "" : fold(val.split(/[\s,]+/).pop().replace(/^#/, ""));
    const all = Model.tagCounts(state.model).map(([tg]) => tg).filter((tg) => !current.includes(tg) || fold(tg) === last);
    const matches = all.filter((tg) => !last || (fold(tg).startsWith(last) && fold(tg) !== last)).slice(0, 12);
    $("#tag-suggest").innerHTML = matches.map((tg) => `<button type="button" class="tag" data-tag="${esc(tg)}">#${esc(tg)}</button>`).join("");
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    stopRecording();
    const err = (key, el, params) => { $("#editor-error").textContent = t(key, params); el.focus(); };
    const keys = editorKeys();
    if (!keys.length) return err("error.keys", comboInputs()[0]);
    if (!form.what.value.trim()) return err("error.action", form.what);
    const path = editorPath();
    if (!path.length) return err("error.folder", form.folder);
    if (path.length > Model.MAX_DEPTH) return err("error.depth", form.folder, { max: Model.MAX_DEPTH });
    const fields = {
      keys, action: form.what.value, description: form.description.value, tags: form.tags.value,
      version: form.version.value, favorite: form.favorite.checked,
    };
    const ed = state.editing;
    dialog.close();
    await commit((m) => {
      let id = ed && ed.id;
      if (ed && !Model.locate(m, id)) {
        const hit = Model.allEntries(m).find(({ entry }) => sigOf(entry) === ed.sig);
        id = hit && hit.entry.id;
      }
      if (id) Model.updateEntry(m, id, fields, path);
      else Model.addEntry(m, path, fields);
    });
  });

  // Themed replacements for prompt() and confirm(), which browsers draw unstyled.
  // ask({ message, value }) → the text, or null; ask({ message, danger: true }) → true/false.
  function ask({ message, value, okLabel, danger }) {
    const box = $("#ask"), input = $("#ask-input"), ok = $("#ask-ok");
    const isPrompt = value !== undefined;
    $("#ask-message").textContent = message;
    input.hidden = !isPrompt;
    input.value = isPrompt ? value : "";
    ok.textContent = okLabel || t("action.ok");
    ok.classList.toggle("danger", !!danger);
    box.returnValue = "";
    box.showModal();
    (isPrompt ? input : ok).focus();
    if (isPrompt) input.select();
    return new Promise((resolve) => {
      box.addEventListener("close", () => {
        const accepted = box.returnValue === "ok";
        resolve(isPrompt ? (accepted ? input.value : null) : accepted);
      }, { once: true });
    });
  }
  $("#ask-form").addEventListener("submit", (ev) => { ev.preventDefault(); $("#ask").close("ok"); });
  $("#ask-cancel").addEventListener("click", () => $("#ask").close("cancel"));
  const confirmDelete = (message) => ask({ message, okLabel: t("action.delete"), danger: true });

  $("#editor-cancel").addEventListener("click", () => dialog.close());
  $("#editor-delete").addEventListener("click", async () => {
    const ed = state.editing;
    if (!ed) return;
    const loc = Model.locate(state.model, ed.id);
    if (loc && await confirmDelete(t("confirm.deleteShortcut", { name: loc.entry.action }))) {
      commit((m) => Model.deleteEntry(m, ed.id));
      dialog.close();
    }
  });
  dialog.addEventListener("close", () => { stopRecording(); state.editing = null; });
  form.folder.addEventListener("input", editorChanged);
  form.tags.addEventListener("input", suggestTags);
  $("#tag-suggest").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-tag]");
    if (!b) return;
    const parts = form.tags.value.split(/[\s,]+/).filter(Boolean);
    if (!/[\s,]$/.test(form.tags.value) && parts.length) parts.pop();
    parts.push(b.dataset.tag);
    form.tags.value = parts.join(" ") + " ";
    form.tags.focus();
    suggestTags();
  });

  // ---- folder actions ----
  async function folderAction(act, path) {
    if (act === "sub") {
      const name = Model.cleanFolderName(await ask({ message: t("prompt.folderName"), value: "" }) || "");
      if (!name) return;
      const p = path.concat(name);
      commit((m) => Model.addFolder(m, p)).then(() => selectFolder(p));
    } else if (act === "version") {
      const f = Model.findFolder(state.model, path);
      if (!f) return;
      const v = await ask({ message: t("prompt.version", { name: path[path.length - 1] }), value: f.version });
      if (v === null || v.trim() === f.version) return;
      commit((m) => Model.setFolderVersion(m, path, v));
    } else if (act === "rename") {
      const old = path[path.length - 1];
      const name = Model.cleanFolderName(await ask({ message: t("prompt.rename", { name: old }), value: old }) || "");
      if (!name || name === old) return;
      const p = path.slice(0, -1).concat(name);
      if (state.levels[path.length - 1] === old && folderAllowed(path.slice(0, -1))) { state.levels[path.length - 1] = name; store.set("levels", state.levels); }
      if (state.folder && within(state.folder, path)) { state.folder = p.concat(state.folder.slice(path.length)); store.set("folder", state.folder); }
      commit((m) => Model.renameFolder(m, path, name));
    } else if (act === "delete") {
      const f = Model.findFolder(state.model, path);
      const count = f ? Model.countEntries(f) : 0;
      if (!await confirmDelete(t("confirm.deleteFolder", { name: path[path.length - 1], count }))) return;
      if (state.folder && within(state.folder, path)) state.folder = null;
      commit((m) => Model.deleteFolder(m, path));
    }
  }

  // ---- events ----
  $("#tree").addEventListener("click", (ev) => {
    const r = ev.target.closest(".tree-row");
    if (!r) return;
    const path = Model.splitPath(r.dataset.path);
    const act = ev.target.closest("[data-act]");
    if (act && act.dataset.act === "toggle") {
      const k = pathKey(path);
      state.collapsed.has(k) ? state.collapsed.delete(k) : state.collapsed.add(k);
      store.set("collapsed", [...state.collapsed]);
      renderTree();
      return;
    }
    if (act) { folderAction(act.dataset.act, path); return; }
    selectFolder(path);
  });
  $("#tree").addEventListener("keydown", (ev) => {
    const r = ev.target.closest(".tree-row");
    if (!r) return;
    const rows = [...document.querySelectorAll("#tree .tree-row")];
    const i = rows.indexOf(r);
    const path = Model.splitPath(r.dataset.path);
    const k = pathKey(path);
    if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); selectFolder(path); focusRow(k); }
    else if (ev.key === "ArrowDown" && rows[i + 1]) { ev.preventDefault(); rows[i + 1].focus(); }
    else if (ev.key === "ArrowUp" && rows[i - 1]) { ev.preventDefault(); rows[i - 1].focus(); }
    else if (ev.key === "ArrowRight" && state.collapsed.has(k)) { state.collapsed.delete(k); store.set("collapsed", [...state.collapsed]); renderTree(); focusRow(k); }
    else if (ev.key === "ArrowLeft" && path.length && !state.collapsed.has(k) && r.hasAttribute("aria-expanded")) { state.collapsed.add(k); store.set("collapsed", [...state.collapsed]); renderTree(); focusRow(k); }
  });
  const focusRow = (k) => { const el = [...document.querySelectorAll("#tree .tree-row")].find((x) => x.dataset.path === k); if (el) el.focus(); };

  // Drag a card or a folder onto a folder in the tree to move it there.
  let dragged = null;
  document.addEventListener("dragstart", (ev) => {
    if (readOnly) return;
    const card = ev.target.closest && ev.target.closest(".card");
    const row = ev.target.closest && ev.target.closest(".tree-row");
    if (card) { dragged = { id: card.dataset.id }; card.classList.add("dragging"); }
    else if (row && row.dataset.path) dragged = { path: Model.splitPath(row.dataset.path) };
    else return;
    ev.dataTransfer.effectAllowed = "move";
    ev.dataTransfer.setData("text/plain", card ? ((Model.locate(state.model, card.dataset.id) || {}).entry?.keys || []).join(" / ") : row.dataset.path);
  });
  document.addEventListener("dragend", () => {
    dragged = null;
    document.querySelectorAll(".dragging, .drop").forEach((el) => el.classList.remove("dragging", "drop"));
  });
  $("#tree").addEventListener("dragover", (ev) => {
    const r = ev.target.closest(".tree-row");
    if (!dragged || !r) return;
    if (dragged.path && within(Model.splitPath(r.dataset.path), dragged.path)) return;
    if (dragged.id && !r.dataset.path) return; // shortcuts belong under an OS
    ev.preventDefault();
    document.querySelectorAll(".drop").forEach((el) => el !== r && el.classList.remove("drop"));
    r.classList.add("drop");
  });
  $("#tree").addEventListener("dragleave", (ev) => {
    const r = ev.target.closest(".tree-row");
    if (r && !r.contains(ev.relatedTarget)) r.classList.remove("drop");
  });
  $("#tree").addEventListener("drop", (ev) => {
    const r = ev.target.closest(".tree-row");
    if (!dragged || !r) return;
    ev.preventDefault();
    const dest = Model.splitPath(r.dataset.path);
    const d = dragged;
    if (d.id) commit((m) => Model.updateEntry(m, d.id, {}, dest));
    else if (d.path) {
      if (state.folder && within(state.folder, d.path)) state.folder = dest.concat(state.folder.slice(d.path.length - 1));
      commit((m) => Model.moveFolder(m, d.path, dest));
    }
  });

  $("#list").addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    if (b.dataset.tag) toggleTag(b.dataset.tag);
    else if (b.classList.contains("ctx")) selectFolder(Model.splitPath(b.dataset.path));
    else if (b.dataset.act === "fav") commit((m) => Model.toggleFavorite(m, b.dataset.id));
    else if (b.dataset.act === "edit") openEditor((Model.locate(state.model, b.dataset.id) || {}).entry);
    else if (b.dataset.act === "delete") {
      const loc = Model.locate(state.model, b.dataset.id);
      if (loc) confirmDelete(t("confirm.deleteShortcut", { name: loc.entry.action })).then((yes) => yes && commit((m) => Model.deleteEntry(m, b.dataset.id)));
    }
  });
  $("#list").addEventListener("dblclick", (ev) => {
    const card = ev.target.closest(".card");
    if (card && !ev.target.closest("button")) openEditor((Model.locate(state.model, card.dataset.id) || {}).entry);
  });
  $("#tags").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-tag]");
    if (b) toggleTag(b.dataset.tag);
  });
  $("#crumbs").addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (b) selectFolder(b.dataset.path ? Model.splitPath(b.dataset.path) : null);
  });
  $("#filters").addEventListener("change", (ev) => {
    const sel = ev.target.closest("select[data-level]");
    if (sel) setLevel(Number(sel.dataset.level), sel.value);
  });

  let searchTimer = null;
  $("#search").addEventListener("input", (ev) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.query = ev.target.value; render(); }, 60);
  });
  $("#search").addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") { setQuery(""); ev.target.blur(); }
  });
  $("#fav-btn").addEventListener("click", toggleFavOnly);
  $("#add-btn").addEventListener("click", () => openEditor(null));
  $("#new-folder").addEventListener("click", () => folderAction("sub", state.folder || []));
  $("#theme-btn").addEventListener("click", () => {
    state.theme = THEMES[(THEMES.indexOf(state.theme) + 1) % THEMES.length];
    themeStore.set(state.theme);
    applyTheme();
  });
  $("#menu-btn").addEventListener("click", () => document.body.classList.toggle("side-open"));
  $("#scrim").addEventListener("click", () => document.body.classList.remove("side-open"));

  const langSel = $("#lang");
  langSel.innerHTML = i18n.languages().map((l) => `<option value="${esc(l.code)}">${esc(l.name)}</option>`).join("");
  langSel.addEventListener("change", () => {
    store.set("lang", langSel.value);
    i18n.setLang(langSel.value);
    applyLanguage();
  });

  document.addEventListener("keydown", (ev) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || dialog.open || $("#ask").open;
    if (typing || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.key === "/") { ev.preventDefault(); $("#search").focus(); }
    else if (ev.key === "n" && !readOnly) { ev.preventDefault(); openEditor(null); }
    else if (ev.key === "f") { ev.preventDefault(); toggleFavOnly(); }
  });

  // ---- start ----
  i18n.setLang(store.get("lang", null) || i18n.pick(navigator.languages || [navigator.language]));
  langSel.value = i18n.lang;
  applyLanguage();
  listen();
})();
