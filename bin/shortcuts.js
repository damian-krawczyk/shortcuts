#!/usr/bin/env node
// shortcuts CLI: serve (edit in the browser), build (static HTML for GitHub Pages), validate.
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { execFile, execFileSync } = require("child_process");
const Model = require("../src/model.js");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");

const USAGE = `Usage:
  shortcuts serve [file.md] [--port 4190] [--host 127.0.0.1] [--open]
      Serve the page with editing; saves go straight to file.md.
  shortcuts build [file.md] [-o dist/index.html]
      Write a single self-contained, read-only HTML file (for GitHub Pages).
  shortcuts validate [file.md]
      Check the file; exits 1 on errors.

file.md defaults to ./shortcuts.md.`;

// ---- argument parsing -------------------------------------------------------

function parseArgs(argv) {
  const flags = {}, rest = [];
  const alias = { o: "out", p: "port" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const m = /^--?([\w-]+)(?:=(.*))?$/.exec(a);
    if (!m) { rest.push(a); continue; }
    const key = alias[m[1]] || m[1];
    if (m[2] !== undefined) flags[key] = m[2];
    else if (["open", "help"].includes(key)) flags[key] = true;
    else flags[key] = argv[++i];
  }
  return { flags, rest };
}

// ---- page rendering ---------------------------------------------------------

const read = (p) => fs.readFileSync(p, "utf8");
const scriptSafe = (s) => s.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");

function loadLocales() {
  const dir = path.join(SRC, "locales");
  const out = {};
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    out[path.basename(f, ".json")] = JSON.parse(read(path.join(dir, f)));
  }
  return out;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function renderHtml({ markdown, config, title }) {
  const scripts = ["model.js", "i18n.js", "app.js"].map((f) => read(path.join(SRC, f)));
  const data = { markdown, config, locales: loadLocales() };
  const parts = {
    "{{TITLE}}": escapeHtml(title || "Shortcuts"),
    "/*{{CSS}}*/": read(path.join(SRC, "style.css")),
    "/*{{DATA}}*/": "window.SHORTCUTS_DATA = " + JSON.stringify(data).replace(/</g, "\\u003c") + ";",
    "/*{{SCRIPTS}}*/": scripts.map(scriptSafe).join("\n;\n"),
  };
  // One pass, so text inside the inlined parts is never mistaken for a placeholder.
  return read(path.join(SRC, "template.html")).replace(/\{\{TITLE\}\}|\/\*\{\{(?:CSS|DATA|SCRIPTS)\}\}\*\//g, (m) => parts[m]);
}

// When the page was rendered and which commit of the shortcuts file's repo it shows.
// Uses git in the file's folder; in GitHub Actions falls back to GITHUB_SHA.
function buildInfo(file) {
  const dir = path.dirname(path.resolve(file));
  const git = (...args) => {
    try { return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch (_) { return ""; }
  };
  const sha = git("rev-parse", "HEAD") || process.env.GITHUB_SHA || "";
  let repoUrl = process.env.GITHUB_REPOSITORY ? `${process.env.GITHUB_SERVER_URL || "https://github.com"}/${process.env.GITHUB_REPOSITORY}` : "";
  if (!repoUrl) {
    const m = /^(?:https:\/\/|git@)([^/:]+)[/:](.+?)(?:\.git)?$/.exec(git("remote", "get-url", "origin"));
    if (m) repoUrl = `https://${m[1]}/${m[2]}`;
  }
  return {
    time: new Date().toISOString(),
    commit: sha.slice(0, 7),
    commitUrl: sha && repoUrl ? `${repoUrl}/commit/${sha}` : "",
  };
}

function titleOf(markdown) {
  return Model.parse(markdown).model.title || "Shortcuts";
}

// ---- commands ---------------------------------------------------------------

function report({ errors, warnings }) {
  for (const w of warnings) console.log(`warning: ${w}`);
  for (const e of errors) console.log(`error: ${e}`);
}

function validate(file) {
  const { model, errors, warnings } = Model.validate(read(file));
  report({ errors, warnings });
  const entries = Model.allEntries(model);
  const favs = entries.filter(({ entry }) => entry.favorite).length;
  console.log(`${file}: ${entries.length} shortcuts (${favs} favorites), ${Model.allFolders(model).length} folders, ${errors.length} errors, ${warnings.length} warnings`);
  return errors.length ? 1 : 0;
}

function build(file, out) {
  const markdown = read(file);
  report(Model.validate(markdown));
  out = out || path.join("dist", "index.html");
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, renderHtml({ markdown, title: titleOf(markdown), config: { readOnly: true, fileName: path.basename(file), build: buildInfo(file) } }));
  console.log(`wrote ${out}`);
  return 0;
}

function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

// ---- server -----------------------------------------------------------------

const hash = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 16);

function readBody(req, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("too large")); req.destroy(); }
      else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function serve(file, flags) {
  const abs = path.resolve(file);
  const host = flags.host || "127.0.0.1";
  const port = Number(flags.port || process.env.SHORTCUTS_PORT || 4190);
  const clients = new Set();
  let lastWritten = null; // hash of what we wrote, so our own saves don't echo as "changed"

  const current = () => read(abs);
  const send = (res, code, type, body, extra = {}) => res.writeHead(code, Object.assign({ "Content-Type": type, "Cache-Control": "no-store" }, extra)).end(body);
  const json = (res, code, obj) => send(res, code, "application/json; charset=utf-8", JSON.stringify(obj));
  const broadcast = (event) => { for (const c of clients) c.write(`data: ${JSON.stringify(event)}\n\n`); };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    try {
      if (url.pathname === "/" && req.method === "GET") {
        const markdown = current();
        return send(res, 200, "text/html; charset=utf-8", renderHtml({
          markdown, title: titleOf(markdown),
          config: { readOnly: false, fileName: path.basename(abs), version: hash(markdown), build: buildInfo(abs) },
        }));
      }
      if (url.pathname === "/api/shortcuts" && req.method === "GET") {
        const markdown = current();
        return send(res, 200, "text/markdown; charset=utf-8", markdown, { ETag: hash(markdown) });
      }
      if (url.pathname === "/api/shortcuts" && req.method === "PUT") {
        // Only accept writes from this page (blocks other sites posting to localhost).
        if (req.headers["x-shortcuts"] !== "1") return json(res, 403, { error: "forbidden" });
        const body = await readBody(req);
        const disk = current();
        const base = req.headers["if-match"];
        if (base && base !== hash(disk)) return json(res, 409, { error: "conflict", version: hash(disk) });
        const { errors } = Model.validate(body);
        if (errors.length) return json(res, 422, { error: errors.join("; ") });
        lastWritten = hash(body);
        writeAtomic(abs, body);
        broadcast({ type: "saved", version: lastWritten });
        return json(res, 200, { ok: true, version: lastWritten });
      }
      if (url.pathname === "/events") {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
        res.write(": hi\n\n");
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }
      send(res, 404, "text/plain", "not found");
    } catch (e) {
      json(res, 500, { error: e.message });
    }
  });

  // Edits made outside the page (an editor, git pull) reach open pages.
  let timer = null;
  fs.watchFile(abs, { interval: 500 }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      let text;
      try { text = current(); } catch (_) { return; }
      const v = hash(text);
      if (v === lastWritten) return;
      lastWritten = v;
      console.log(`${file} changed on disk`);
      broadcast({ type: "changed", version: v });
    }, 150);
  });
  setInterval(() => { for (const c of clients) c.write(": ping\n\n"); }, 25000).unref();

  server.on("error", (e) => {
    console.error(e.code === "EADDRINUSE" ? `port ${port} is in use; try --port ${port + 1}` : e.message);
    process.exit(1);
  });
  server.listen(port, host, () => {
    const link = `http://${host === "0.0.0.0" ? "localhost" : host}:${port}/`;
    console.log(`serving ${file} at ${link}  (Ctrl+C to stop)`);
    if (flags.open) {
      const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
      execFile(cmd, [link], () => {});
    }
  });
  return null;
}

// ---- main -------------------------------------------------------------------

function main(argv) {
  const [cmd, ...args] = argv;
  const { flags, rest } = parseArgs(args);
  if (!cmd || flags.help || cmd === "help") { console.log(USAGE); return 0; }
  const file = rest[0] || "shortcuts.md";
  if (["serve", "build", "validate"].includes(cmd) && !fs.existsSync(file)) {
    if (cmd === "serve" && !rest[0]) {
      fs.writeFileSync(file, Model.serialize(Model.emptyModel("Shortcuts")));
      console.log(`created ${file}`);
    } else {
      console.error(`no such file: ${file}`);
      return 2;
    }
  }
  switch (cmd) {
    case "serve": return serve(file, flags);
    case "build": return build(file, flags.out);
    case "validate": return validate(file);
    default: console.error(USAGE); return 2;
  }
}

if (require.main === module) {
  const code = main(process.argv.slice(2));
  if (typeof code === "number") process.exitCode = code;
}

module.exports = { renderHtml, parseArgs, main };
