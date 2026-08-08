# Changelog

## v0.3.0 (Unreleased) — Multi-Format Editor

### ✨ New Features

- **Multi-format file support** — OneMarkdown now opens and edits many file types beyond Markdown:
  - **Code**: Rust, Python, JavaScript, TypeScript, Go, Java, C/C++, Ruby, PHP, Swift, Kotlin, and 30+ more languages
  - **Data**: JSON, YAML, TOML, CSV/TSV, XML
  - **Web**: HTML, CSS, SCSS, LESS
  - **Text**: TXT, LOG, INI, CFG, CONF, ENV
  - Special files: Makefile, Dockerfile, CMakeLists.txt, etc.

- **Syntax-highlighted code preview** — Non-Markdown files render with full syntax highlighting in the preview pane

- **File type detection** — Automatic detection based on file extension with visual badge in toolbar and status bar

- **Preview mode toggle** (`Ctrl+M`) — Switch between rendered preview and syntax-highlighted source view

- **Smart file dialogs** — Open dialog shows categorized filters (All Supported, Markdown, Code, Data, Web, Text, All Files)

- **Context-aware toolbar** — Markdown-only buttons (bold, italic, headings, etc.) hide automatically for non-Markdown files

- **Type-aware save** — Save dialog defaults to appropriate file extension based on current file type

### 🔧 Improvements

- Expanded keyboard shortcuts: `Ctrl+M` for mode toggle
- Status bar now shows file type label
- Drag & drop supports all recognized file types
- Auto-continue lists only activates for Markdown files
- Image paste only available in Markdown mode

### 🏗️ Architecture

- Added `FileType` enum with extension-based detection in Rust backend
- New `render_code` Tauri command for syntax-highlighted code rendering
- New `detect_file_type` command for file type identification
- `FileInfo` struct now includes `file_type` and `language` fields
- Exposed `highlight_code` function from markdown module for reuse
