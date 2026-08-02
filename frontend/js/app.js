// OneMarkdown — Frontend
const { invoke } = window.__TAURI__.core;
const { open, save } = window.__TAURI__.dialog;

// ─── State ────────────────────────────────────────────────────────
let currentPath = '';
let isModified = false;
let renderTimer = null;
let undoTimer = null;

// ─── DOM ──────────────────────────────────────────────────────────
const $ = (s) => document.querySelector(s);
const editor    = $('#editor');
const preview   = $('#preview');
const fileTitle = $('#file-title');
const aiPanel   = $('#ai-panel');
const aiOutput  = $('#ai-output');

const status = {
  file:   $('#st-file'),
  words:  $('#st-words'),
  chars:  $('#st-chars'),
  lines:  $('#st-lines'),
  cursor: $('#st-cursor'),
};

// ─── Init ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  bindEditor();
  bindToolbar();
  bindAI();
  bindResizer();
  bindShortcuts();
  bindWindowClose();

  editor.value = `# Welcome to OneMarkdown

> Open, write, publish. One file is all you need.

## Why OneMarkdown?

- **Single file** — no Vault, no project, just open a \`.md\` and work
- **AI-native** — explain, rewrite, translate, summarize in-place
- **Fast** — Rust + Tauri, launches in milliseconds
- **Portable** — images embed as base64 or save to \`.assets/\`

## Quick Start

1. Write your Markdown here
2. See the preview on the right
3. Paste images directly — they're saved automatically
4. Press \`Ctrl+L\` to open AI assistant

## Code Example

\`\`\`rust
fn main() {
    println!("Hello, OneMarkdown!");
}
\`\`\`

## Table

| Shortcut | Action |
|----------|--------|
| Ctrl+N | New file |
| Ctrl+O | Open file |
| Ctrl+S | Save |
| Ctrl+L | AI Assistant |
| Ctrl+B | Bold |
| Ctrl+I | Italic |
| Ctrl+Z | Undo |
| Ctrl+Shift+Z | Redo |

---

*Start writing — one file is all you need.*`;

  renderPreview();
  updateStatus();
});

// ─── Editor events ────────────────────────────────────────────────
function bindEditor() {
  editor.addEventListener('input', () => {
    isModified = true;
    updateTitle();
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderPreview, 120);
    updateStatus();
  });

  editor.addEventListener('click', updateCursorPos);
  editor.addEventListener('keyup', updateCursorPos);

  // Tab key — preserve undo history by using execCommand
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      // execCommand preserves undo stack
      if (e.shiftKey) {
        // Unindent: remove up to 4 spaces from line start
        const s = editor.selectionStart;
        const ls = editor.value.lastIndexOf('\n', s - 1) + 1;
        const lineStart = editor.value.substring(ls, ls + 4);
        if (lineStart === '    ') {
          editor.setSelectionRange(ls, ls + 4);
          document.execCommand('insertText', false, '');
        }
      } else {
        document.execCommand('insertText', false, '    ');
      }
    }
  });

  // Image paste
  editor.addEventListener('paste', async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = reader.result.split(',')[1];
          try {
            const result = await invoke('save_pasted_image', {
              imageData: base64,
              mimeType: item.type,
            });
            insertText(result.markdownRef);
          } catch (err) {
            console.error('Image paste error:', err);
            insertText(`![image](${reader.result})`);
          }
        };
        reader.readAsDataURL(file);
        break;
      }
    }
  });

  // Scroll sync
  editor.addEventListener('scroll', () => {
    const pct = editor.scrollTop / (editor.scrollHeight - editor.clientHeight || 1);
    preview.scrollTop = pct * (preview.scrollHeight - preview.clientHeight);
  });
}

// ─── Render ───────────────────────────────────────────────────────
async function renderPreview() {
  try {
    const res = await invoke('render_markdown', { content: editor.value });
    preview.innerHTML = res.html;
  } catch (err) {
    preview.innerHTML = `<p style="color:var(--red)">Render error: ${err}</p>`;
  }
}

// ─── Toolbar ──────────────────────────────────────────────────────
function bindToolbar() {
  $('#btn-new').onclick = newFile;
  $('#btn-open').onclick = openFile;
  $('#btn-save').onclick = saveFile;
  $('#btn-export').onclick = exportHtml;

  $('#btn-bold').onclick   = () => wrap('**', '**');
  $('#btn-italic').onclick = () => wrap('*', '*');
  $('#btn-strike').onclick = () => wrap('~~', '~~');
  $('#btn-code').onclick   = () => {
    const sel = editor.value.substring(editor.selectionStart, editor.selectionEnd);
    sel.includes('\n') ? wrap('```\n', '\n```') : wrap('`', '`');
  };
  $('#btn-link').onclick  = insertLink;
  $('#btn-image').onclick = () => insertText('![alt](url)');
  $('#btn-h1').onclick    = () => linePrefix('# ');
  $('#btn-h2').onclick    = () => linePrefix('## ');
  $('#btn-h3').onclick    = () => linePrefix('### ');
  $('#btn-list').onclick  = () => linePrefix('- ');
  $('#btn-olist').onclick = () => linePrefix('1. ');
  $('#btn-quote').onclick = () => linePrefix('> ');
  $('#btn-hr').onclick    = () => insertText('\n---\n');
  $('#btn-table').onclick = () => insertText('\n| Header | Header |\n|--------|--------|\n| Cell   | Cell   |\n');
}

// ─── AI ───────────────────────────────────────────────────────────
function bindAI() {
  $('#btn-ai').onclick = () => aiPanel.classList.toggle('hidden');
  $('#ai-close').onclick = () => aiPanel.classList.add('hidden');

  document.querySelectorAll('.ai-btn').forEach(btn => {
    btn.onclick = () => handleAiAction(btn.dataset.action);
  });
}

async function handleAiAction(action) {
  const sel = editor.value.substring(editor.selectionStart, editor.selectionEnd);
  const fullContent = editor.value;
  aiOutput.textContent = '⏳ Thinking...';

  try {
    let result;
    switch (action) {
      case 'explain':
        result = await invoke('ai_explain', { text: sel || fullContent, context: sel ? fullContent : null });
        break;
      case 'summarize':
        result = await invoke('ai_summarize', { content: fullContent, maxSentences: 5 });
        break;
      case 'translate':
        const lang = prompt('Translate to:', 'English');
        if (!lang) return;
        result = await invoke('ai_translate', { text: sel || fullContent, targetLang: lang });
        break;
      case 'rewrite':
        const instr = prompt('How to rewrite?', 'Make it more concise and professional');
        if (!instr) return;
        result = await invoke('ai_rewrite', { text: sel || fullContent, instruction: instr });
        break;
      case 'context':
        result = { text: await invoke('ai_context_bundle', { content: fullContent, includeFrontmatter: true }) };
        break;
    }
    aiOutput.textContent = result?.text || '(empty response)';
  } catch (err) {
    aiOutput.textContent = `❌ ${err}`;
  }
}

// ─── Shortcuts ────────────────────────────────────────────────────
function bindShortcuts() {
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;

    switch (e.key) {
      case 'n': e.preventDefault(); newFile(); break;
      case 'o': e.preventDefault(); openFile(); break;
      case 's': e.preventDefault(); e.shiftKey ? saveFileAs() : saveFile(); break;
      case 'b': e.preventDefault(); wrap('**', '**'); break;
      case 'i': e.preventDefault(); wrap('*', '*'); break;
      case 'k': e.preventDefault(); insertLink(); break;
      case 'e': e.preventDefault(); wrap('`', '`'); break;
      case 'l': e.preventDefault(); aiPanel.classList.toggle('hidden'); break;
      // Ctrl+Z / Ctrl+Shift+Z — let browser handle undo/redo natively
      // Ctrl+Enter — insert newline below
      case 'Enter':
        if (mod) {
          e.preventDefault();
          const pos = editor.selectionEnd;
          const rest = editor.value.slice(pos);
          const nextLine = rest.startsWith('\n') ? '' : '\n';
          insertText(nextLine + '\n');
        }
        break;
    }
  });
}

// ─── Window close protection ──────────────────────────────────────
function bindWindowClose() {
  window.addEventListener('beforeunload', (e) => {
    if (isModified) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

// ─── File operations ──────────────────────────────────────────────
async function newFile() {
  if (isModified && !confirm('Discard unsaved changes?')) return;
  await invoke('new_file');
  editor.value = '';
  currentPath = '';
  isModified = false;
  updateTitle();
  renderPreview();
  updateStatus();
}

async function openFile() {
  try {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] }],
    });
    if (!selected) return;

    const info = await invoke('open_file', { path: selected });
    editor.value = info.content;
    currentPath = info.path;
    isModified = false;
    status.file.textContent = info.path;
    updateTitle();
    renderPreview();
    updateStatus();
  } catch (err) {
    console.error('Open error:', err);
  }
}

async function saveFile() {
  if (!currentPath) return saveFileAs();
  try {
    await invoke('save_file', { content: editor.value });
    isModified = false;
    updateTitle();
  } catch (err) {
    console.error('Save error:', err);
  }
}

async function saveFileAs() {
  try {
    const filePath = await save({
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (!filePath) return;

    await invoke('save_file_as', { path: filePath, content: editor.value });
    currentPath = filePath;
    isModified = false;
    status.file.textContent = filePath;
    updateTitle();
  } catch (err) {
    console.error('Save as error:', err);
  }
}

async function exportHtml() {
  try {
    const filePath = await save({
      filters: [{ name: 'HTML', extensions: ['html'] }],
    });
    if (!filePath) return;

    await invoke('export_html', { content: editor.value, path: filePath });
    alert(`Exported to ${filePath}`);
  } catch (err) {
    console.error('Export error:', err);
  }
}

// ─── Text helpers (use execCommand to preserve undo stack) ─────────
function wrap(before, after) {
  const s = editor.selectionStart;
  const e = editor.selectionEnd;
  const sel = editor.value.substring(s, e);

  // Use execCommand to preserve undo history
  editor.focus();
  const replacement = before + (sel || '') + after;
  document.execCommand('insertText', false, replacement);

  // Adjust selection
  if (!sel) {
    editor.selectionStart = editor.selectionEnd = s + before.length;
  }
  editor.dispatchEvent(new Event('input'));
}

function insertText(text) {
  editor.focus();
  document.execCommand('insertText', false, text);
  editor.dispatchEvent(new Event('input'));
}

function linePrefix(prefix) {
  const s = editor.selectionStart;
  const ls = editor.value.lastIndexOf('\n', s - 1) + 1;
  const currentLine = editor.value.substring(ls);

  // Check if line already has this prefix (toggle off)
  if (currentLine.startsWith(prefix)) {
    editor.setSelectionRange(ls, ls + prefix.length);
    document.execCommand('delete', false);
  } else {
    editor.setSelectionRange(ls, ls);
    document.execCommand('insertText', false, prefix);
  }
  editor.dispatchEvent(new Event('input'));
}

function insertLink() {
  const sel = editor.value.substring(editor.selectionStart, editor.selectionEnd);
  sel ? wrap('[', '](url)') : insertText('[text](url)');
}

// ─── Resizer ──────────────────────────────────────────────────────
function bindResizer() {
  const resizer = $('#resizer');
  const ep = $('#editor-pane');
  let dragging = false, startX = 0, startW = 0;

  resizer.addEventListener('mousedown', (e) => {
    dragging = true;
    startX = e.clientX;
    startW = ep.offsetWidth;
    resizer.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const total = $('#main').offsetWidth;
    const w = Math.max(200, Math.min(total - 200 - 3, startW + (e.clientX - startX)));
    ep.style.flex = 'none';
    ep.style.width = w + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove('active');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
}

// ─── Status bar ───────────────────────────────────────────────────
function updateStatus() {
  const text = editor.value;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  status.words.textContent = `${words} words`;
  status.chars.textContent = `${text.length} chars`;
  status.lines.textContent = `${text.split('\n').length} lines`;
  updateCursorPos();
}

function updateCursorPos() {
  const pos = editor.selectionStart;
  const before = editor.value.substring(0, pos);
  const ln = before.split('\n').length;
  const col = pos - before.lastIndexOf('\n');
  status.cursor.textContent = `Ln ${ln}, Col ${col}`;
}

function updateTitle() {
  const name = currentPath ? currentPath.split(/[/\\]/).pop() : 'Untitled';
  fileTitle.textContent = isModified ? `${name} •` : name;
}
