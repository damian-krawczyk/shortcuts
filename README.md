# shortcuts

Your keyboard shortcuts in one human-readable Markdown file, [`shortcuts.md`](shortcuts.md). They are
grouped in up to six levels of headings that mean whatever you want (for example operating system →
software → section), with optional versions, and you can mark your favorites.
The file reads well on GitHub (favorites show as ticked checkboxes) and diffs cleanly in git. You
browse and edit it in a web page with level filters, a tree, instant search, tags, a favorites filter,
a key recorder, dark/light mode and an English / Polish / Spanish interface. The same file builds
into a single static HTML page for GitHub Pages.

## Quick start

```sh
npm install
npm run serve        # edit shortcuts.md at http://127.0.0.1:4190/ (opens the browser)
npm run dev          # the same, with the sample examples/shortcuts.md
npm run build        # dist/index.html: self-contained, read-only, works offline
npm test
```

Editing works only in `serve` mode. Every change is written straight to `shortcuts.md`. If you
edit the file yourself (in an editor, or with `git pull`), open pages reload. If the file changed
since the page loaded, the save is refused and the page reloads the latest version, so nothing is
overwritten silently.

## Keeping your shortcuts in your own repository

The tool can serve, edit and build a shortcuts file in any folder. You don't need to fork or copy
this repo. For example, you can keep your shortcuts in a private repo and use this one only as
the tool. Pick one of these three setups.

### Option 1: add the tool to your shortcuts repo (recommended)

In your shortcuts repository:

```sh
npm init -y
npm install --save-dev github:damian-krawczyk/shortcuts
```

Add these scripts to its `package.json`:

```json
"scripts": {
  "serve": "shortcuts serve shortcuts.md --open",
  "build": "shortcuts build shortcuts.md -o dist/index.html",
  "validate": "shortcuts validate shortcuts.md"
}
```

Add a `.gitignore` containing:

```
node_modules/
dist/
```

`npm run serve` then edits that repo's own `shortcuts.md`. If the file doesn't exist yet, it is
created. The repo holds only `shortcuts.md`, `package.json`, `package-lock.json` and
`.gitignore`. The lock file pins the tool to one commit, so it changes only when you run
`npm update shortcuts`.

If the tool's repository is private, npm needs access to it through your GitHub SSH key or
credentials.

### Option 2: install the command globally

```sh
npm install -g https://codeload.github.com/damian-krawczyk/shortcuts/tar.gz/main
cd path/to/your-shortcuts-repo
shortcuts serve --open          # uses ./shortcuts.md, created if missing
```

Run the same install command again to update. Alternatively, run `npm link` in a clone of this
repo. Use the tarball URL above rather than `github:damian-krawczyk/shortcuts`: with `-g`, npm
can link the command to a temporary clone that it then deletes, and you get
`command not found: shortcuts`. If zsh still reports that after installing, run `rehash` or open
a new terminal.

This is the most convenient setup, but your shortcuts repo doesn't record which version of the
tool it uses.

### Option 3: run it from a clone of this repo

```sh
node path/to/shortcuts/bin/shortcuts.js serve path/to/your-shortcuts-repo/shortcuts.md --open
```

This needs no setup, but it only works on machines where this repo is cloned at that path.

### VS Code task

To start the server with **Cmd+Shift+B** (Ctrl+Shift+B on Windows and Linux), add
`.vscode/tasks.json` to your shortcuts repo:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Serve shortcuts.md on the LOCALHOST",
      "type": "shell",
      "command": "npx shortcuts serve shortcuts.md --open",
      "group": { "kind": "build", "isDefault": true },
      "isBackground": true,
      "problemMatcher": {
        "owner": "shortcuts",
        "pattern": { "regexp": "^(no such file): (.*)$", "kind": "file", "file": 2, "message": 1 },
        "background": { "activeBegins": true, "beginsPattern": "^(serving |created )", "endsPattern": "^serving .* at http://" }
      }
    }
  ]
}
```

### Publishing your shortcuts repo to GitHub Pages

Copy [`.github/workflows/pages.yml`](.github/workflows/pages.yml) into your repo. In its `paths:`
trigger, keep only `shortcuts.md`, `package*.json` and the workflow file. Replace its `npm test`
and `node bin/shortcuts.js …` steps with:

```yaml
      - run: npx shortcuts validate shortcuts.md
      - run: npx shortcuts build shortcuts.md -o dist/index.html
```

Then turn on Pages in the repo's **Settings → Pages → Source → GitHub Actions**.

- On GitHub Free, Pages works only from a public repository.
- On paid plans, a site published from a private repository is still public, unless you're on
  GitHub Enterprise, which can restrict it.
- To keep your shortcuts private, skip Pages:
  - Run `npm run serve` to edit them, then push the Markdown file as a backup with its full history.
  - `npm run build` produces a single `index.html` that works offline.

## The file format

```md
---
title: My shortcuts
---

# macOS
version: 15 Sequoia

- [x] `Cmd+Space` Spotlight — search apps and files

## VS Code
version: 1.95

### Editing

- [x] `Shift+Cmd+P` / `F1` Command Palette — run any command
  tags: #essential
- [ ] `Cmd+K Cmd+S` Keyboard Shortcuts editor
  version: 1.90+
  More description lines are
  indented like this.
```

- **Front matter:** the optional YAML block at the top holds the page `title`. Any other keys
  in it are kept as they are when the page saves the file.
- **Headings:** headings are folders, and `#` to `######` are levels 1 to 6. The levels mean
  whatever you decide. This example uses OS → software → section, but `# VS Code` /
  `## macOS` works just as well. Shortcuts can sit at any level.
- **Versions:** a `version:` line right under a heading is the version of that folder, such as
  an OS or an app. A `version:` line under a shortcut overrides the nearest version above it for
  that one shortcut (e.g. `1.90+`). Versions are free text and optional.
- **Shortcuts:** `- [x]` is a favorite and `- [ ]` is not. Then come the keys in backticks:
  - Alternatives are separated by ` / `.
  - Steps of a chord are separated by a space (`Cmd+K Cmd+S`).
  - Next comes the action, then an optional `— description`.
  - The `tags:` line, the `version:` line and any further indented lines are optional.
- **Keys:** keys are stored in plain ASCII (`Ctrl`, `Alt`, `Shift`, `Cmd`, `Win`, `Super`,
  `Fn`, `Esc`, `Enter`, `Up`, `F5`…).
  - Aliases are accepted and normalised: `command`, `⌘`, `option` and `⌥` become `Cmd` and `Alt`.
  - Modifiers are put in a fixed order: Fn, Win/Super, Ctrl, Alt, Shift, Cmd.
  - The page draws keys with ⌃⌥⇧⌘ when any heading in a shortcut's path names macOS (or
    iOS), and with `Ctrl` `Alt` `Win` otherwise.
- **Canonical form:** the page writes the file back in this canonical form and keeps the order
  of entries, so diffs stay small. Lines that aren't shortcuts are kept as notes, and `validate`
  warns about them.

## In the browser

- **Level filters**: above the list there is one dropdown per heading level that exists in the
  file (*Level 1*, *Level 2*, …). Each one lists the names found at that level, with counts.
  - A level filter applies across branches: *Level 2 = VS Code* with *Level 1 = All* lists VS
    Code under every level-1 heading.
  - Filters combine. Each dropdown offers only the names left after the levels before it.
  - *(directly in level N)* lists the shortcuts that sit in a level-N folder itself, not in one
    of its subfolders.
  - The tree shows only the folders that still have matching shortcuts.
  - *Add shortcut* starts in the folder the filters point to.
- **Tree**: click a folder to list it, including its subfolders. Hover a row to:
  - add a subfolder;
  - set its version (**v**);
  - rename it;
  - delete it.

  Drag shortcuts or folders onto a row to move them.
- **Favorites**: click ★ on a card to toggle it. The **★ Favorites** button (or `f`) shows only
  favorites.
- **Search**: filters as you type across action, description, keys, tags, folder names and versions.
  - Key names match their aliases: `command p`, `cmd+p` and `⌘p` all find ⌘P.
  - It ignores accents.
  - `#tag` filters by tag, `is:fav` shows favorites and `os:mac` (or `os:win`, `os:linux`, or any
    folder name) the shortcuts for one system.
  - Terms combine.
- **Add / edit**: use the *Add shortcut* button, `n`, or double-click a card.
  - Type the keys, or click **Record** and press them. Several presses make a chord, and
    recording stops after a short pause.
  - **+ Alternative keys** adds another combo.
  - The editor warns when the keys are already used under the same first two levels.
- **Keys**: `/` search, `n` new shortcut, `f` favorites, `Esc` close.
- The theme (auto/light/dark), language, selected folder, level filters and favorites filter are
  remembered per browser.

## GitHub Pages

[`.github/workflows/pages.yml`](.github/workflows/pages.yml) runs the tests on every push to
`main` that changes `shortcuts.md` (or the code), then builds the page and deploys it. One-time
setup: in the repo, go to **Settings → Pages → Source** and choose **GitHub Actions**.

The deployed page is read-only: it shows favorites but can't change them. To edit, run
`npm run serve` locally, then commit and push. If the repository is public, your shortcuts are
public too (GitHub Pages on a private repository needs a paid plan).

## Adding a language

1. Copy `src/locales/en.json` to `src/locales/<code>.json`, for example `de.json`, and translate
   the values. Set `_name` to the language's own name (`Deutsch`).
2. Plurals use [CLDR categories](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html)
   as key suffixes (`.one`, `.few`, `.many`, `.other`). Include the ones your language uses.
3. Run `npm test`, which checks that every language has the same keys as English. The new
   language then appears in the picker. The build includes every file in `src/locales/`.

## Layout

```
bin/shortcuts.js   CLI: serve, build, validate
src/model.js       shortcuts.md ⇄ folder tree; keys, versions, favorites, edits (shared by Node and the page)
src/app.js         the page: level filters, tree, list, favorites, search, editor with key recorder, theme, language
src/i18n.js        translations, plurals
src/locales/       en.json, pl.json, es.json
src/template.html  page shell; build inlines CSS, JS, translations and data into it
CHANGELOG.md       what changed in each version
```

There are no runtime dependencies.
