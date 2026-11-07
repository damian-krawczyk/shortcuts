# Changelog

All notable changes to this project are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- README section on keeping your shortcuts in your own repository: install the tool as a dev
  dependency or globally, or run it from a clone. It also covers a VS Code task and publishing
  to GitHub Pages.

## [1.0.0] - 2026-11-07

First version, based on the [bookmarks](https://github.com/damian-krawczyk/bookmarks) project and
its approach: one Markdown file, a local page that edits it, and a static page for GitHub Pages.

### Added

- **`shortcuts.md` file format**:
  - Headings are folders, up to 6 levels. The levels mean whatever you want (for example OS →
    software → section).
  - Each shortcut is a line `- [x] `Keys` Action — description`. `[x]` marks a favorite.
  - Keys can have alternatives (`` `Cmd+D` / `F1` ``) and chords (`Cmd+K Cmd+S`).
  - Optional `tags:`, `version:` and extra description lines go under a shortcut.
- **Versions**: a `version:` line under a heading sets the version of that folder, such as an OS
  or an app. A `version:` line under a shortcut overrides it for that shortcut.
- **YAML front matter** for the page title. Other keys in it are kept when the file is saved.
  Older `<!-- title: … -->` comments are still read.
- **Key normalisation**: aliases (`command`, `⌘`, `option`…) become canonical ASCII names, and
  modifiers are put in a fixed order. Keys are shown with macOS symbols (⌃⌥⇧⌘) when a heading in
  the path names macOS, and PC names otherwise.
- **CLI** (`bin/shortcuts.js`):
  - `serve` edits the file in the browser. Saves are atomic. Edits made outside the page reload
    open pages, and a save over a file that changed in the meantime is refused.
  - `build` writes a single read-only HTML page.
  - `validate` reports missing keys or actions and duplicate keys, and exits 1 on errors.
- **Web page**:
  - **Navigation**: level filters (one dropdown per heading level, with counts), a folder tree
    with drag and drop, tags.
  - **Favorites**: a ★ toggle on each card and a favorites filter (`f`).
  - **Search** with key aliases (`cmd+p` finds ⌘P), `#tag`, `is:fav` and `os:mac`.
  - **Editor** with a key recorder, alternative key combos, and a warning for keys that are
    already used.
  - Dark/light theme and English, Polish and Spanish interfaces.
- **Tooling**:
  - GitHub Pages workflow that tests, validates, builds and deploys the page.
  - VS Code tasks to serve, build, validate and test.
  - Tests using `node:test`.

[Unreleased]: https://github.com/damian-krawczyk/shortcuts/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/damian-krawczyk/shortcuts/releases/tag/v1.0.0
