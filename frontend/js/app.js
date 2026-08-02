// OneMarkdown — Frontend (Phase 1)
const { invoke } = window.__TAURI__.core;
const { open, save } = window.__TAURI__.dialog;
const { listen } = window.__TAURI__.event;

// ─── State ────────────────────────────────────────────────────────
let currentPath = '';
let isModified = false;
let renderTimer = null;
let autoSaveTimer = null;
let currentTheme = localStorage.getItem('theme') || 'dark';

// ─── DOM ──────────────────────────────────────────────────────────
const $ = (s) => document.querySelector(s);
const editor    = $('#editor');
const preview   = $('#preview');
const fileTitle = $('#file-title');
const aiPanel   = $('#ai-panel');
const aiOutput  = $('#ai-output');

const status = {
  file:     $('#st-file'),
  words:    $('#st-words'),
  chars:    $('#st-chars'),
  lines:    $('#st-lines'),
  readTime: $('#st-read-time'),
  cursor:   $('#st-cursor'),
  saved:    $('#st-auto-saved'),
};

// ─── Init ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  applyTheme(currentTheme);
  bindEditor();
  bindToolbar();
  bindAI();
  bindSearch();
  bindRecent();
  bindSettings();
  bindResizer();
  bindShortcuts();
  bindWindowClose();
  bindDragDrop();
  bindFileWatcher();
  loadSettingsIntoUI();

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
5. Press \`Ctrl+F\` to search, \`Ctrl+H\` to search & replace

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
| Ctrl+F | Search |
| Ctrl+H | Search & Replace |
| Ctrl+L | AI Assistant |
| Ctrl+B | Bold |
| Ctrl+I | Italic |

---

*Start writing — one file is all you need.*`;

  renderPreview();
  updateStatus();
});

// ─── Theme ────────────────────────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  currentTheme = theme;
  localStorage.setItem('theme', theme);
  const btn = $('#btn-theme');
  if (btn) btn.textContent = theme === 'dark' ? '🌙' : '☀️';
}

// ─── Editor events ────────────────────────────────────────────────
function bindEditor() {
  editor.addEventListener('input', () => {
    isModified = true;
    updateTitle();
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderPreview, 120);
    updateStatus();
    scheduleAutoSave();
  });

  editor.addEventListener('click', updateCursorPos);
  editor.addEventListener('keyup', updateCursorPos);

  // Tab key — preserves undo
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        const s = editor.selectionStart;
        const ls = editor.value.lastIndexOf('\n', s - 1) + 1;
        if (editor.value.substring(ls, ls + 4) === '    ') {
          editor.setSelectionRange(ls, ls + 4);
          document.execCommand('insertText', false, '');
        }
      } else {
        document.execCommand('insertText', false, '    ');
      }
    }

    // Enter — auto-continue lists
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
      const s = editor.selectionStart;
      const lineStart = editor.value.lastIndexOf('\n', s - 1) + 1;
      const line = editor.value.substring(lineStart, s);
      const bulletMatch = line.match(/^(\s*)([-*+]|\d+\.)\s/);
      if (bulletMatch) {
        const trimmedLine = line.trim();
        // If line is just a bullet with no content, remove it
        if (trimmedLine === '-' || trimmedLine === '*' || trimmedLine === '+' || /^\d+\.$/.test(trimmedLine)) {
          editor.setSelectionRange(lineStart, s);
          document.execCommand('insertText', false, '\n');
          e.preventDefault();
          return;
        }
        e.preventDefault();
        const indent = bulletMatch[1];
        const bullet = bulletMatch[2];
        // Increment number for ordered lists
        let newBullet = bullet;
        if (/^\d+\.$/.test(bullet)) {
          newBullet = (parseInt(bullet) + 1) + '.';
        }
        document.execCommand('insertText', false, '\n' + indent + newBullet + ' ');
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
  $('#btn-print').onclick = printPreview;
  $('#btn-theme').onclick = () => applyTheme(currentTheme === 'dark' ? 'light' : 'dark');

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

// ─── Search & Replace ─────────────────────────────────────────────
function bindSearch() {
  const bar = $('#search-bar');
  const input = $('#search-input');
  const replaceInput = $('#replace-input');
  const countEl = $('#search-count');
  const regexCb = $('#search-regex');
  const caseCb = $('#search-case');

  let matches = [];
  let currentMatch = -1;

  function doSearch() {
    const query = input.value;
    if (!query) { matches = []; currentMatch = -1; countEl.textContent = '0/0'; clearHighlights(); return; }

    const text = editor.value;
    const useRegex = regexCb.checked;
    const caseSensitive = caseCb.checked;

    matches = [];
    try {
      if (useRegex) {
        const flags = caseSensitive ? 'g' : 'gi';
        const re = new RegExp(query, flags);
        let m;
        while ((m = re.exec(text)) !== null) {
          matches.push({ start: m.index, end: m.index + m[0].length });
          if (matches.length > 10000) break; // safety
        }
      } else {
        const searchIn = caseSensitive ? text : text.toLowerCase();
        const searchFor = caseSensitive ? query : query.toLowerCase();
        let pos = 0;
        while ((pos = searchIn.indexOf(searchFor, pos)) !== -1) {
          matches.push({ start: pos, end: pos + query.length });
          pos += query.length;
        }
      }
    } catch (e) {
      // Invalid regex
    }

    currentMatch = matches.length > 0 ? 0 : -1;
    countEl.textContent = `${matches.length > 0 ? currentMatch + 1 : 0}/${matches.length}`;

    if (currentMatch >= 0) goToMatch();
  }

  function goToMatch() {
    if (currentMatch < 0 || currentMatch >= matches.length) return;
    const m = matches[currentMatch];
    editor.focus();
    editor.setSelectionRange(m.start, m.end);
    // Scroll into view
    const linesBefore = editor.value.substring(0, m.start).split('\n').length;
    const lineHeight = parseFloat(getComputedStyle(editor).lineHeight);
    editor.scrollTop = (linesBefore - 5) * lineHeight;
    countEl.textContent = `${currentMatch + 1}/${matches.length}`;
  }

  function nextMatch() {
    if (matches.length === 0) return;
    currentMatch = (currentMatch + 1) % matches.length;
    goToMatch();
  }

  function prevMatch() {
    if (matches.length === 0) return;
    currentMatch = (currentMatch - 1 + matches.length) % matches.length;
    goToMatch();
  }

  function replaceOne() {
    if (currentMatch < 0) return;
    const m = matches[currentMatch];
    const replacement = replaceInput.value;
    editor.setSelectionRange(m.start, m.end);
    document.execCommand('insertText', false, replacement);
    // Re-search after replace
    doSearch();
  }

  function replaceAll() {
    if (matches.length === 0) return;
    const replacement = replaceInput.value;
    // Replace from end to start to preserve positions
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];
      editor.setSelectionRange(m.start, m.end);
      document.execCommand('insertText', false, replacement);
    }
    doSearch();
  }

  function clearHighlights() {
    // Native selection is enough
  }

  // Event bindings
  input.addEventListener('input', doSearch);
  regexCb.addEventListener('change', doSearch);
  caseCb.addEventListener('change', doSearch);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.shiftKey ? prevMatch() : nextMatch(); }
    if (e.key === 'Escape') { bar.classList.add('hidden'); editor.focus(); }
  });

  replaceInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') replaceOne();
    if (e.key === 'Escape') { bar.classList.add('hidden'); editor.focus(); }
  });

  $('#search-next').onclick = nextMatch;
  $('#search-prev').onclick = prevMatch;
  $('#search-close').onclick = () => { bar.classList.add('hidden'); editor.focus(); };
  $('#replace-one').onclick = replaceOne;
  $('#replace-all').onclick = replaceAll;

  // Expose for shortcuts
  window._searchBar = bar;
  window._searchInput = input;
  window._replaceInput = replaceInput;
  window._doSearch = doSearch;
}

// ─── Recent files ─────────────────────────────────────────────────
function bindRecent() {
  const panel = $('#recent-panel');
  const list = $('#recent-list');

  async function showRecent() {
    try {
      const files = await invoke('get_recent_files');
      if (files.length === 0) {
        list.innerHTML = '<div class="panel-empty">No recent files</div>';
      } else {
        list.innerHTML = files.map((f, i) => {
          const name = f.split(/[/\\]/).pop();
          return `<div class="panel-item" data-path="${f}" data-idx="${i}">
            <span class="item-name" title="${f}">${name}</span>
            <span class="item-path">${f}</span>
          </div>`;
        }).join('');

        list.querySelectorAll('.panel-item').forEach(el => {
          el.onclick = async () => {
            const path = el.dataset.path;
            panel.classList.add('hidden');
            try {
              const info = await invoke('open_file', { path });
              editor.value = info.content;
              currentPath = info.path;
              isModified = false;
              status.file.textContent = info.path;
              updateTitle();
              renderPreview();
              updateStatus();
              startWatching(info.path);
            } catch (err) {
              alert(`Cannot open: ${err}`);
            }
          };
        });
      }
    } catch (err) {
      list.innerHTML = `<div class="panel-empty">Error: ${err}</div>`;
    }

    panel.classList.toggle('hidden');
  }

  $('#btn-recent').onclick = showRecent;
  $('#recent-close').onclick = () => panel.classList.add('hidden');
}

// ─── Settings ─────────────────────────────────────────────────────
function bindSettings() {
  const panel = $('#settings-panel');

  $('#btn-settings').onclick = () => {
    loadSettingsIntoUI();
    panel.classList.toggle('hidden');
  };
  $('#settings-close').onclick = () => panel.classList.add('hidden');

  $('#settings-save').onclick = async () => {
    const settings = {
      imageStrategy: { assetDir: {} }[$('#set-image-strategy').value] || { inline: {} },
      fontSize: parseInt($('#set-font-size').value) || 15,
      tabSize: parseInt($('#set-tab-size').value) || 4,
      wordWrap: $('#set-word-wrap').checked,
      autoSave: $('#set-auto-save').checked,
      aiEndpoint: $('#set-ai-endpoint').value,
      aiKey: $('#set-ai-key').value,
      aiModel: $('#set-ai-model').value,
    };

    // Map select value to enum
    if ($('#set-image-strategy').value === 'inline') {
      settings.imageStrategy = { inline: {} };
    } else {
      settings.imageStrategy = { assetDir: {} };
    }

    try {
      await invoke('save_settings', { settings });
      // Apply editor settings
      editor.style.fontSize = settings.fontSize + 'px';
      editor.style.tabSize = settings.tabSize;
      editor.style.whiteSpace = settings.wordWrap ? 'pre-wrap' : 'pre';
      panel.classList.add('hidden');
      flashSaved();
    } catch (err) {
      alert(`Save settings error: ${err}`);
    }
  };
}

async function loadSettingsIntoUI() {
  try {
    const s = await invoke('get_settings');
    $('#set-font-size').value = s.fontSize || 15;
    $('#set-tab-size').value = s.tabSize || 4;
    $('#set-word-wrap').checked = s.wordWrap !== false;
    $('#set-auto-save').checked = s.autoSave !== false;
    $('#set-image-strategy').value = s.imageStrategy?.inline ? 'inline' : 'assetDir';
    $('#set-ai-endpoint').value = s.aiEndpoint || '';
    $('#set-ai-key').value = s.aiKey || '';
    $('#set-ai-model').value = s.aiModel || '';

    // Apply
    editor.style.fontSize = (s.fontSize || 15) + 'px';
    editor.style.tabSize = s.tabSize || 4;
    editor.style.whiteSpace = s.wordWrap !== false ? 'pre-wrap' : 'pre';
  } catch (err) {
    console.error('Load settings error:', err);
  }
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

// ─── Drag & Drop ──────────────────────────────────────────────────
function bindDragDrop() {
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    // Check if it's a markdown file
    const name = file.name.toLowerCase();
    if (name.endsWith('.md') || name.endsWith('.markdown') || name.endsWith('.mdown') || name.endsWith('.txt')) {
      // Tauri file path
      if (file.path) {
        try {
          const info = await invoke('open_file', { path: file.path });
          editor.value = info.content;
          currentPath = info.path;
          isModified = false;
          status.file.textContent = info.path;
          updateTitle();
          renderPreview();
          updateStatus();
          startWatching(info.path);
        } catch (err) {
          console.error('Drop open error:', err);
        }
      }
    }
  });
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
      case 'p': e.preventDefault(); printPreview(); break;
      case 'f':
        e.preventDefault();
        window._searchBar.classList.remove('hidden');
        window._searchInput.focus();
        // If text selected, use it as search query
        const sel = editor.value.substring(editor.selectionStart, editor.selectionEnd);
        if (sel) {
          window._searchInput.value = sel;
          window._doSearch();
        }
        window._searchInput.select();
        break;
      case 'h':
        e.preventDefault();
        window._searchBar.classList.remove('hidden');
        window._replaceInput.focus();
        break;
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

// ─── Auto-save ────────────────────────────────────────────────────
function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(async () => {
    if (!isModified || !currentPath) return;
    try {
      await invoke('save_file', { content: editor.value });
      isModified = false;
      updateTitle();
      flashSaved();
    } catch (err) {
      console.error('Auto-save error:', err);
    }
  }, 3000); // 3 second debounce
}

function flashSaved() {
  status.saved.textContent = '✓ saved';
  status.saved.classList.add('show');
  setTimeout(() => status.saved.classList.remove('show'), 2000);
}

// ─── File watcher (external change detection) ───────────────────
function bindFileWatcher() {
  listen('file-changed', async () => {
    if (!currentPath) return;
    // Prompt user to reload
    const name = currentPath.split(/[/\\]/).pop();
    const reload = confirm(`"${name}" has been modified externally.\n\nReload with the new version?`);
    if (reload) {
      try {
        const info = await invoke('open_file', { path: currentPath });
        editor.value = info.content;
        isModified = false;
        updateTitle();
        renderPreview();
        updateStatus();
      } catch (err) {
        console.error('Reload error:', err);
      }
    } else {
      isModified = true;
      updateTitle();
    }
  });
}

async function startWatching(path) {
  try {
    await invoke('start_watching', { path });
  } catch (err) {
    console.error('Watch error:', err);
  }
}

async function stopWatching() {
  try {
    await invoke('stop_watching');
  } catch (err) {
    // ignore
  }
}

// ─── Print support ────────────────────────────────────────────────
function printPreview() {
  // Open print dialog with preview content
  window.print();
}

// ─── File operations ──────────────────────────────────────────────
async function newFile() {
  if (isModified && !confirm('Discard unsaved changes?')) return;
  stopWatching();
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
    startWatching(info.path);
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
    flashSaved();
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
    flashSaved();
    startWatching(filePath);
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

// ─── Text helpers (execCommand preserves undo) ────────────────────
function wrap(before, after) {
  editor.focus();
  const sel = editor.value.substring(editor.selectionStart, editor.selectionEnd);
  const replacement = before + (sel || '') + after;
  document.execCommand('insertText', false, replacement);
  if (!sel) {
    const s = editor.selectionStart;
    editor.selectionStart = editor.selectionEnd = s - after.length;
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
  const chars = text.length;
  const lines = text.split('\n').length;
  const readMin = Math.max(1, Math.ceil(words / 200));

  status.words.textContent = `${words} words`;
  status.chars.textContent = `${chars} chars`;
  status.lines.textContent = `${lines} lines`;
  status.readTime.textContent = `~${readMin} min read`;
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
