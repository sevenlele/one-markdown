# OneMarkdown

> Open, write, publish. One file is all you need.

A fast, AI-native Markdown editor built with Rust + Tauri. No Vault, no project management — just open a `.md` file and write.

## ✨ What makes it different

| Feature | OneMarkdown | Obsidian | Typora |
|---------|:-----------:|:--------:|:------:|
| Single-file workflow | ✅ | ❌ (Vault) | ✅ |
| AI built-in | ✅ | ❌ (plugins) | ❌ |
| Open source | ✅ | Partial | ❌ |
| Startup speed | <100ms | ~500ms | ~300ms |
| Install size | ~5MB | ~200MB | ~80MB |
| Image paste to base64 | ✅ | ❌ | ❌ |
| Context Bundle for AI | ✅ | ❌ | ❌ |

## 🚀 Quick Start

```bash
# Prerequisites: Rust + Node.js + system deps (see below)

# Clone & run
git clone https://github.com/user/one-markdown.git
cd one-markdown
cargo tauri dev

# Build release
cargo tauri build
```

### System dependencies

**Linux:**
```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

**macOS:** `xcode-select --install`

**Windows:** [VS Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) + [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)

## 📁 Single-File Workflow

OneMarkdown's core philosophy: **one `.md` file is all you need.**

- No Vault or project folder required
- Images paste directly as base64 data URIs (or to `.assets/` — configurable)
- Metadata lives in frontmatter at the top of the file
- Export to standalone HTML anytime

```markdown
---
title: My Post
tags: [rust, markdown]
---

# Content starts here

Write, preview, done.
```

## 🤖 AI Features

Press `Ctrl+L` to open the AI panel. Configure your API endpoint in Settings.

- **Explain** — explain selected text or the whole document
- **Summarize** — concise summary in 5 sentences
- **Translate** — translate to any language
- **Rewrite** — rewrite with custom instructions
- **Context Bundle** — package your document for AI consumption

Uses OpenAI-compatible API (works with OpenAI, Anthropic via proxy, local LLMs, etc.)

## 📝 Callouts / Admonitions

OneMarkdown supports callouts (admonitions) — colored blocks with icons for highlighting important information.

### Syntax

```markdown
> [!note] Title
> Content goes here.
> Multiple lines are supported.
```

The title is optional — if omitted, the type label is used:

```markdown
> [!tip]
> This is a tip without a custom title.
```

### Supported Types

| Type | Label | Icon |
|------|-------|------|
| `note` | Note | 📝 |
| `tip` | Tip | 💡 |
| `warning` | Warning | ⚠️ |
| `danger` | Danger | 🔥 |
| `info` | Info | ℹ️ |
| `question` | Question | ❓ |
| `example` | Example | 📋 |
| `quote` | Quote | 💬 |
| `bug` | Bug | 🐛 |

### Example

```markdown
> [!warning] Careful!
> This operation cannot be undone.

> [!tip]
> Use Ctrl+S to save your work frequently.
```

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+N | New file |
| Ctrl+O | Open file |
| Ctrl+S | Save |
| Ctrl+Shift+S | Save as |
| Ctrl+B | Bold |
| Ctrl+I | Italic |
| Ctrl+K | Insert link |
| Ctrl+E | Inline code |
| Ctrl+L | Toggle AI panel |
| Tab / Shift+Tab | Indent / Unindent |
| Ctrl+Enter | Insert newline below |

## 🏗️ Architecture

```
one-markdown/
├── src/
│   ├── main.rs              # Tauri entry, command registration
│   ├── core/
│   │   ├── frontmatter.rs   # YAML frontmatter parser/serializer
│   │   ├── markdown.rs      # pulldown-cmark + syntect rendering
│   │   └── assets.rs        # Image paste handling (base64 / .assets/)
│   └── commands/
│       ├── editor.rs        # File ops, rendering, settings
│       └── ai.rs            # AI integration (OpenAI-compatible)
└── frontend/
    ├── index.html           # UI structure
    ├── css/style.css        # Dark theme
    └── js/app.js            # Editor logic, shortcuts, AI panel
```

## 📦 Dependencies

| Crate | Purpose |
|-------|---------|
| `tauri` | Cross-platform app shell |
| `pulldown-cmark` | Markdown parsing (CommonMark + GFM) |
| `syntect` | Code syntax highlighting |
| `serde` / `serde_yaml` | Frontmatter serialization |
| `base64` / `sha2` | Image embedding |
| `reqwest` | AI API client |
| `notify` | File watching |
| `chrono` | Timestamps |

## 📄 License

MIT
