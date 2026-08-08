// OneMarkdown — Frontend (Multi-Format Support)
const { invoke } = window.__TAURI__.core;
const { open, save } = window.__TAURI__.dialog;
const { listen } = window.__TAURI__.event;

// ─── State ────────────────────────────────────────────────────────
let currentPath = '';
let isModified = false;
let renderTimer = null;
let autoSaveTimer = null;
let currentTheme = localStorage.getItem('theme') || 'dark';
let aiStreaming = false;
let aiStreamText = '';
let aiContinuation = false;
let continueBox = null;
let customKeys = {};
let aiChatMode = false;
let aiChatHistory = [];

// Multi-format state
let currentFileType = 'markdown'; // 'markdown' | 'code' | 'text' | 'json' | 'yaml' | 'csv' | 'html' | 'xml' | 'toml'
let currentLanguage = 'markdown';
let previewMode = 'preview'; // 'preview' | 'source' — toggle between rendered and source view

// ─── DOM ──────────────────────────────────────────────────────────
const $ = (s) => document.querySelector(s);
const editor    = $('#editor');
const preview   = $('#preview');
const fileTitle = $('#file-title');
const aiPanel   = $('#ai-panel');
const aiOutput  = $('#ai-output');
const aiStatus  = $('#ai-status');
const aiStopBtn = $('#ai-stop');

const status = {
  file:     $('#st-file'),
  filetype: $('#st-filetype'),
  words:    $('#st-words'),
  chars:    $('#st-chars'),
  lines:    $('#st-lines'),
  readTime: $('#st-read-time'),
  cursor:   $('#st-cursor'),
  saved:    $('#st-auto-saved'),
};

// ─── Supported file extensions for open dialog ────────────────────
const SUPPORTED_EXTENSIONS = [
  { name: 'All Supported', extensions: [
    'md', 'markdown', 'mdx', 'txt', 'log', 'json', 'jsonc', 'json5',
    'yml', 'yaml', 'toml', 'csv', 'tsv', 'html', 'htm', 'xhtml',
    'xml', 'svg', 'rss', 'atom', 'xsl',
    'rs', 'py', 'js', 'ts', 'jsx', 'tsx', 'go', 'java', 'c', 'cpp',
    'h', 'hpp', 'cs', 'rb', 'php', 'swift', 'kt', 'scala', 'r',
    'lua', 'pl', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
    'sql', 'graphql', 'proto', 'dart', 'zig', 'nim', 'ex', 'exs',
    'erl', 'hs', 'ml', 'clj', 'cljs', 'lisp', 'el', 'jl',
    'vue', 'svelte', 'astro', 'css', 'scss', 'sass', 'less',
    'ini', 'cfg', 'conf', 'env', 'gitignore', 'dockerignore',
    'editorconfig', 'makefile', 'cmake', 'gradle', 'dockerfile'
  ]},
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdx'] },
  { name: 'Code', extensions: [
    'rs', 'py', 'js', 'ts', 'jsx', 'tsx', 'go', 'java', 'c', 'cpp',
    'h', 'hpp', 'cs', 'rb', 'php', 'swift', 'kt', 'scala', 'r',
    'lua', 'pl', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
    'sql', 'graphql', 'proto', 'dart', 'zig', 'nim', 'ex', 'exs',
    'erl', 'hs', 'ml', 'clj', 'cljs', 'lisp', 'el', 'jl',
    'vue', 'svelte', 'astro', 'css', 'scss', 'sass', 'less'
  ]},
  { name: 'Data', extensions: ['json', 'jsonc', 'json5', 'yml', 'yaml', 'toml', 'csv', 'tsv', 'xml'] },
  { name: 'Web', extensions: ['html', 'htm', 'xhtml', 'css', 'scss', 'js', 'ts'] },
  { name: 'Text', extensions: ['txt', 'log', 'ini', 'cfg', 'conf', 'env'] },
  { name: 'All Files', extensions: ['*'] },
];

// ─── File type display info ───────────────────────────────────────
const FILE_TYPE_INFO = {
  markdown: { label: 'Markdown', icon: '📝', color: '#58a6ff' },
  code:     { label: 'Code',     icon: '💻', color: '#7ee787' },
  text:     { label: 'Text',     icon: '📄', color: '#8b949e' },
  json:     { label: 'JSON',     icon: '📋', color: '#f0883e' },
  yaml:     { label: 'YAML',     icon: '📋', color: '#f0883e' },
  csv:      { label: 'CSV',      icon: '📊', color: '#d2a8ff' },
  html:     { label: 'HTML',     icon: '🌐', color: '#f97583' },
  xml:      { label: 'XML',      icon: '📋', color: '#f0883e' },
  toml:     { label: 'TOML',     icon: '📋', color: '#f0883e' },
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

[toc]

## Why OneMarkdown?

- **Single file** — no Vault, no project, just open a \`.md\` and work
- **AI-native** — explain, rewrite, translate, summarize in-place
- **Fast** — Rust + Tauri, launches in milliseconds
- **Portable** — images embed as base64 or save to \`.assets/\`
- **Multi-format** — open code, JSON, YAML, CSV, HTML, and more

## Quick Start

1. Write your Markdown here
2. See the preview on the right
3. Paste images directly — they're saved automatically
4. Press \`Ctrl+L\` to open AI assistant
5. Press \`Ctrl+F\` to search, \`Ctrl+H\` to search & replace
6. Press \`Ctrl+M\` to toggle preview/source mode

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
| Ctrl+M | Toggle Mode |

---

## Math

Inline math: $E = mc^2$ and $\\sum_{i=1}^{n} x_i = x_1 + x_2 + \\cdots + x_n$

Block math:

$$\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}$$

$$\\frac{n!}{k!(n-k)!} = \\binom{n}{k}$$

## Callouts

> [!tip] Getting Started
> Callouts highlight important information with colored blocks and icons.

> [!warning]
> Be careful with unsaved changes!

> [!info] Supported types
> note, tip, warning, danger, info, question, example, quote, bug

---

*Start writing — one file is all you need.*`;

  setFileType('markdown', 'markdown');
  renderPreview();
  updateStatus();
});

// ─── File Type Management ─────────────────────────────────────────

function setFileType(type, language) {
  currentFileType = type;
  currentLanguage = language;

  // Update badge
  const badge = $('#file-type-badge');
  const info = FILE_TYPE_INFO[type] || FILE_TYPE_INFO.text;
  if (badge) {
    badge.textContent = info.icon + ' ' + info.label;
    badge.style.color = info.color;
    badge.style.display = currentPath ? 'inline' : 'none';
  }

  // Update status bar filetype
  if (status.filetype) {
    status.filetype.textContent = info.label;
  }

  // Update mode toggle button
  updateModeButton();

  // Show/hide markdown-only toolbar buttons
  const mdOnlyBtns = ['btn-bold', 'btn-italic', 'btn-strike', 'btn-code',
    'btn-h1', 'btn-h2', 'btn-h3', 'btn-link', 'btn-image', 'btn-list',
    'btn-olist', 'btn-quote', 'btn-hr', 'btn-table', 'btn-ai-edit'];
  const isMd = type === 'markdown';
  mdOnlyBtns.forEach(id => {
    const el = $('#' + id);
    if (el) el.style.display = isMd ? '' : 'none';
  });

  // Update pane label
  const previewLabel = $('#preview-pane .pane-label');
  if (previewLabel) {
    previewLabel.textContent = type === 'markdown' ? 'Preview' : (previewMode === 'preview' ? 'Preview' : 'Source');
  }
}

function isMarkdownType() {
  return currentFileType === 'markdown';
}

function updateModeButton() {
  const btn = $('#btn-mode');
  if (!btn) return;
  if (isMarkdownType()) {
    btn.textContent = previewMode === 'preview' ? '👁' : '📝';
    btn.title = previewMode === 'preview' ? 'Show source (Ctrl+M)' : 'Show preview (Ctrl+M)';
  } else {
    btn.textContent = previewMode === 'preview' ? '📄' : '🎨';
    btn.title = previewMode === 'preview' ? 'Show highlighted (Ctrl+M)' : 'Show raw (Ctrl+M)';
  }
}

function togglePreviewMode() {
  previewMode = previewMode === 'preview' ? 'source' : 'preview';
  updateModeButton();
  renderPreview();
}

// ─── Theme ────────────────────────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  currentTheme = theme;
  localStorage.setItem('theme', theme);
  const btn = $('#btn-theme');
  if (btn) btn.textContent = theme === 'dark' ? '🌙' : '☀️';
  if (mermaidReady) {
    mermaid.initialize({
      startOnLoad: false,
      theme: currentTheme === 'dark' ? 'dark' : 'default',
      securityLevel: 'loose',
    });
  }
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

    // Enter — auto-continue lists (only for markdown)
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && isMarkdownType()) {
      const s = editor.selectionStart;
      const lineStart = editor.value.lastIndexOf('\n', s - 1) + 1;
      const line = editor.value.substring(lineStart, s);
      const bulletMatch = line.match(/^(\s*)([-*+]|\d+\.)\s/);
      if (bulletMatch) {
        const trimmedLine = line.trim();
        if (trimmedLine === '-' || trimmedLine === '*' || trimmedLine === '+' || /^\d+\.$/.test(trimmedLine)) {
          editor.setSelectionRange(lineStart, s);
          document.execCommand('insertText', false, '\n');
          e.preventDefault();
          return;
        }
        e.preventDefault();
        const indent = bulletMatch[1];
        const bullet = bulletMatch[2];
        let newBullet = bullet;
        if (/^\d+\.$/.test(bullet)) {
          newBullet = (parseInt(bullet) + 1) + '.';
        }
        document.execCommand('insertText', false, '\n' + indent + newBullet + ' ');
      }
    }
  });

  // Image paste (only for markdown)
  editor.addEventListener('paste', async (e) => {
    if (!isMarkdownType()) return;
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

// ─── Callout / Admonition types ─────────────────────────────────────
const CALLOUT_TYPES = {
  note:      { label: 'Note',      icon: '📝' },
  tip:       { label: 'Tip',       icon: '💡' },
  warning:   { label: 'Warning',   icon: '⚠️' },
  danger:    { label: 'Danger',    icon: '🔥' },
  info:      { label: 'Info',      icon: 'ℹ️' },
  question:  { label: 'Question',  icon: '❓' },
  example:   { label: 'Example',   icon: '📋' },
  quote:     { label: 'Quote',     icon: '💬' },
  bug:       { label: 'Bug',       icon: '🐛' },
};

function processCallouts() {
  const blockquotes = preview.querySelectorAll('blockquote');
  blockquotes.forEach(bq => {
    const firstP = bq.querySelector('p');
    if (!firstP) return;
    const text = firstP.textContent || '';
    const match = text.match(/^\[!([a-zA-Z]+)\]\s*(.*)/);
    if (!match) return;

    const type = match[1].toLowerCase();
    const meta = CALLOUT_TYPES[type];
    if (!meta) return;

    const title = match[2] || meta.label;

    const callout = document.createElement('div');
    callout.className = 'callout callout-' + type;

    const header = document.createElement('div');
    header.className = 'callout-header';
    header.innerHTML = '<span class="callout-icon">' + meta.icon + '</span><span class="callout-title">' + escapeHtml(title) + '</span>';

    const body = document.createElement('div');
    body.className = 'callout-body';

    const children = Array.from(bq.children);
    let hasBody = false;
    for (let i = 1; i < children.length; i++) {
      body.appendChild(children[i].cloneNode(true));
      hasBody = true;
    }

    callout.appendChild(header);
    if (hasBody) {
      callout.appendChild(body);
    }

    bq.replaceWith(callout);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ─── Mermaid ──────────────────────────────────────────────────────
let mermaidReady = false;

function initMermaid() {
  try {
    if (typeof mermaid !== 'undefined') {
      mermaid.initialize({
        startOnLoad: false,
        theme: currentTheme === 'dark' ? 'dark' : 'default',
        securityLevel: 'loose',
      });
      mermaidReady = true;
    }
  } catch (e) {
    console.error('Mermaid init error:', e);
  }
}

async function renderMermaidDiagrams() {
  if (!mermaidReady) return;
  const blocks = preview.querySelectorAll('code.language-mermaid');
  if (blocks.length === 0) return;

  mermaid.initialize({
    startOnLoad: false,
    theme: currentTheme === 'dark' ? 'dark' : 'default',
    securityLevel: 'loose',
  });

  for (const code of blocks) {
    const pre = code.parentElement;
    const container = document.createElement('div');
    container.className = 'mermaid';
    container.textContent = code.textContent;
    try {
      pre.replaceWith(container);
    } catch (e) {
      console.error('Mermaid replace error:', e);
    }
  }

  try {
    await mermaid.run({ nodes: preview.querySelectorAll('.mermaid') });
  } catch (e) {
    console.error('Mermaid render error:', e);
    preview.querySelectorAll('.mermaid:not([data-processed])').forEach(el => {
      el.innerHTML = `<p style="color:var(--red)">⚠ Mermaid diagram error: ${e.message || e}</p><pre>${el.textContent}</pre>`;
    });
  }
}

// ─── Render ───────────────────────────────────────────────────────
async function renderPreview() {
  if (previewMode === 'source' && !isMarkdownType()) {
    // Source view with syntax highlighting for code files
    try {
      const res = await invoke('render_code', {
        content: editor.value,
        language: currentLanguage,
      });
      preview.innerHTML = res.html;
    } catch (err) {
      // Fallback to plain text display
      preview.innerHTML = `<pre class="code-preview"><code>${escapeHtml(editor.value)}</code></pre>`;
    }
    return;
  }

  if (isMarkdownType()) {
    // Markdown preview
    try {
      const res = await invoke('render_markdown', { content: editor.value });
      preview.innerHTML = res.html;
      processCallouts();
      processFootnotes(preview);
      renderMath(preview);
      generateTOC(preview);
    } catch (err) {
      preview.innerHTML = `<p style="color:var(--red)">Render error: ${err}</p>`;
    }
    await renderMermaidDiagrams();
  } else {
    // For non-markdown files, show syntax-highlighted code
    try {
      const res = await invoke('render_code', {
        content: editor.value,
        language: currentLanguage,
      });
      preview.innerHTML = res.html;
    } catch (err) {
      preview.innerHTML = `<pre class="code-preview"><code>${escapeHtml(editor.value)}</code></pre>`;
    }
  }
}

// ─── Footnotes processing ───────────────────────────────────────
function processFootnotes(container) {
  const refs = container.querySelectorAll('sup a[href^="#fn"]');
  if (refs.length === 0) return;

  const allParagraphs = container.querySelectorAll('p');
  const fnDefs = [];

  allParagraphs.forEach(p => {
    const text = p.textContent;
    const match = text.match(/^\[\^(\w+)\]:\s*(.*)/);
    if (match) {
      const id = match[1];
      const content = match[2];
      fnDefs.push({ id, content, element: p });
    }
  });

  if (fnDefs.length === 0) return;

  const section = document.createElement('div');
  section.className = 'footnotes';
  section.innerHTML = '<hr><ol class="footnotes-list">' +
    fnDefs.map(fn =>
      `<li id="fn-${fn.id}">${fn.content} <a href="#fnref-${fn.id}" class="footnote-backref">↩</a></li>`
    ).join('') +
    '</ol>';

  fnDefs.forEach(fn => fn.element.remove());
  container.appendChild(section);

  refs.forEach(ref => {
    const href = ref.getAttribute('href');
    const num = href.replace('#fn', '');
    ref.setAttribute('href', `#fn-${num}`);
    ref.parentElement.id = `fnref-${num}`;
  });
}

// ─── KaTeX math rendering ──────────────────────────────────────
function renderMath(element) {
  if (typeof katex === 'undefined') return;

  const SKIP_TAGS = new Set(['CODE', 'PRE', 'SCRIPT', 'STYLE', 'TEXTAREA', 'KATEX']);

  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeValue.indexOf('$') === -1) return NodeFilter.FILTER_REJECT;
      let el = node.parentElement;
      while (el && el !== element) {
        if (SKIP_TAGS.has(el.tagName)) return NodeFilter.FILTER_REJECT;
        if (el.classList && el.classList.contains('katex')) return NodeFilter.FILTER_REJECT;
        el = el.parentElement;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);

  for (const textNode of nodes) {
    const text = textNode.nodeValue;
    if (text.indexOf('$') === -1) continue;

    const re = /(\$\$)((?:[^$]|\\\$)+?)\1|(?<!\\)\$((?:[^$\n]|\\\$)+?)\$/g;
    let match;
    let lastIndex = 0;
    const fragments = [];
    let hasMath = false;

    while ((match = re.exec(text)) !== null) {
      hasMath = true;
      if (match.index > lastIndex) {
        fragments.push(document.createTextNode(text.slice(lastIndex, match.index)));
      }

      const isBlock = match[1] === '$$';
      const raw = isBlock ? match[2] : match[3];
      const tex = raw.replace(/\\\$/g, '$');

      try {
        const html = katex.renderToString(tex, {
          displayMode: isBlock,
          throwOnError: false,
          trust: true,
        });
        const span = document.createElement('span');
        span.innerHTML = html;
        fragments.push(isBlock ? wrapBlockMath(span) : span);
      } catch (e) {
        fragments.push(document.createTextNode(isBlock ? `$$${raw}$$` : `$${raw}$`));
      }

      lastIndex = match.index + match[0].length;
    }

    if (!hasMath) continue;

    if (lastIndex < text.length) {
      fragments.push(document.createTextNode(text.slice(lastIndex)));
    }

    const parent = textNode.parentNode;
    if (!parent) continue;
    for (const frag of fragments) {
      parent.insertBefore(frag, textNode);
    }
    parent.removeChild(textNode);
  }
}

function wrapBlockMath(innerSpan) {
  const div = document.createElement('div');
  div.className = 'katex-block';
  div.style.textAlign = 'center';
  div.style.margin = '1em 0';
  div.style.overflowX = 'auto';
  div.appendChild(innerSpan);
  return div;
}

// ─── Table of Contents ───────────────────────────────────────────
function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function generateTOC(container) {
  const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6');
  const filtered = [];
  for (const h of headings) {
    if (h.closest('pre') || h.closest('code')) continue;
    filtered.push(h);
  }

  if (filtered.length === 0) return;

  const usedIds = {};
  for (const h of filtered) {
    if (h.id) continue;
    let base = slugify(h.textContent);
    if (!base) base = 'heading';
    let id = base;
    let n = 2;
    while (usedIds[id]) { id = base + '-' + n++; }
    usedIds[id] = true;
    h.id = id;
  }

  const tocMarkers = [];
  for (const el of container.children) {
    if (el.tagName === 'P' && el.textContent.trim().toLowerCase() === '[toc]') {
      tocMarkers.push(el);
    }
  }
  if (tocMarkers.length === 0) return;

  const tocNav = document.createElement('nav');
  tocNav.className = 'toc';
  tocNav.setAttribute('aria-label', 'Table of Contents');

  const tocTitle = document.createElement('div');
  tocTitle.className = 'toc-title';
  tocTitle.textContent = 'Table of Contents';
  tocNav.appendChild(tocTitle);

  const list = document.createElement('ul');
  list.className = 'toc-list';

  const stack = [{ level: 0, ul: list }];

  for (const h of filtered) {
    const level = parseInt(h.tagName.charAt(1));

    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = '#' + h.id;
    a.textContent = h.textContent;
    a.className = 'toc-link';
    a.addEventListener('click', (e) => {
      e.preventDefault();
      h.scrollIntoView({ behavior: 'smooth', block: 'start' });
      history.replaceState(null, '', '#' + h.id);
    });
    li.appendChild(a);

    while (stack.length > 1 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }

    const parentUl = stack[stack.length - 1].ul;

    if (level > stack[stack.length - 1].level) {
      const subList = document.createElement('ul');
      subList.className = 'toc-list';
      if (parentUl.lastElementChild) parentUl.lastElementChild.appendChild(subList);
      stack.push({ level, ul: subList });
      subList.appendChild(li);
    } else {
      parentUl.appendChild(li);
    }
  }

  tocNav.appendChild(list);

  for (let i = 0; i < tocMarkers.length; i++) {
    const clone = i === 0 ? tocNav : tocNav.cloneNode(true);
    if (i > 0) {
      clone.querySelectorAll('.toc-link').forEach((a) => {
        const targetId = a.getAttribute('href').slice(1);
        const target = document.getElementById(targetId);
        if (target) {
          a.addEventListener('click', (e) => {
            e.preventDefault();
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            history.replaceState(null, '', '#' + targetId);
          });
        }
      });
    }
    tocMarkers[i].replaceWith(clone);
  }
}

// ─── Toolbar ─────────────────────────────────────────────────────
function bindToolbar() {
  $('#btn-new')?.addEventListener('click', newFile);
  $('#btn-open')?.addEventListener('click', openFile);
  $('#btn-save')?.addEventListener('click', saveFile);
  $('#btn-bold')?.addEventListener('click', () => wrapSelection('**', '**'));
  $('#btn-italic')?.addEventListener('click', () => wrapSelection('*', '*'));
  $('#btn-strike')?.addEventListener('click', () => wrapSelection('~~', '~~'));
  $('#btn-code')?.addEventListener('click', () => wrapSelection('`', '`'));
  $('#btn-h1')?.addEventListener('click', () => prefixLine('# '));
  $('#btn-h2')?.addEventListener('click', () => prefixLine('## '));
  $('#btn-h3')?.addEventListener('click', () => prefixLine('### '));
  $('#btn-link')?.addEventListener('click', insertLink);
  $('#btn-image')?.addEventListener('click', insertImage);
  $('#btn-list')?.addEventListener('click', () => prefixLine('- '));
  $('#btn-olist')?.addEventListener('click', () => prefixLine('1. '));
  $('#btn-quote')?.addEventListener('click', () => prefixLine('> '));
  $('#btn-hr')?.addEventListener('click', () => insertText('\n---\n'));
  $('#btn-table')?.addEventListener('click', insertTable);
  $('#btn-export')?.addEventListener('click', exportHtml);
  $('#btn-print')?.addEventListener('click', () => window.print());
  $('#btn-theme')?.addEventListener('click', () => applyTheme(currentTheme === 'dark' ? 'light' : 'dark'));
  $('#btn-mode')?.addEventListener('click', togglePreviewMode);
}

async function newFile() {
  if (isModified && !confirm('Unsaved changes. Continue?')) return;
  try {
    const info = await invoke('new_file');
    editor.value = info.content;
    currentPath = '';
    isModified = false;
    setFileType('markdown', 'markdown');
    updateTitle();
    renderPreview();
    updateStatus();
  } catch (err) {
    console.error('New file error:', err);
  }
}

async function openFile() {
  if (isModified && !confirm('Unsaved changes. Continue?')) return;
  try {
    const selected = await open({
      multiple: false,
      filters: SUPPORTED_EXTENSIONS,
    });
    if (!selected) return;

    const info = await invoke('open_file', { path: selected });
    editor.value = info.content;
    currentPath = info.path;
    isModified = false;

    // Set file type from backend detection
    const fileType = info.fileType || 'markdown';
    const language = info.language || 'markdown';
    setFileType(fileType, language);

    updateTitle();
    renderPreview();
    updateStatus();
    startFileWatcher(selected);
  } catch (err) {
    console.error('Open file error:', err);
  }
}

async function saveFile() {
  try {
    if (currentPath) {
      await invoke('save_file', { content: editor.value });
    } else {
      await saveFileAs();
      return;
    }
    isModified = false;
    updateTitle();
    updateStatus();
    showAutoSaved('Saved');
  } catch (err) {
    console.error('Save error:', err);
  }
}

async function saveFileAs() {
  try {
    // Build save filters based on current file type
    const saveFilters = getSaveFilters();
    const selected = await save({
      filters: saveFilters,
    });
    if (!selected) return;

    await invoke('save_file_as', { path: selected, content: editor.value });
    currentPath = selected;
    isModified = false;

    // Re-detect file type for new path
    try {
      const [fileType, language] = await invoke('detect_file_type', { path: selected });
      setFileType(fileType, language);
    } catch (e) {
      // Fallback
      setFileType('markdown', 'markdown');
    }

    updateTitle();
    updateStatus();
    showAutoSaved('Saved');
    startFileWatcher(selected);
  } catch (err) {
    console.error('Save as error:', err);
  }
}

function getSaveFilters() {
  switch (currentFileType) {
    case 'markdown':
      return [
        { name: 'Markdown', extensions: ['md', 'markdown'] },
        { name: 'All Files', extensions: ['*'] },
      ];
    case 'json':
      return [
        { name: 'JSON', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] },
      ];
    case 'yaml':
      return [
        { name: 'YAML', extensions: ['yml', 'yaml'] },
        { name: 'All Files', extensions: ['*'] },
      ];
    case 'toml':
      return [
        { name: 'TOML', extensions: ['toml'] },
        { name: 'All Files', extensions: ['*'] },
      ];
    case 'html':
      return [
        { name: 'HTML', extensions: ['html', 'htm'] },
        { name: 'All Files', extensions: ['*'] },
      ];
    case 'csv':
      return [
        { name: 'CSV', extensions: ['csv', 'tsv'] },
        { name: 'All Files', extensions: ['*'] },
      ];
    default:
      return [
        { name: 'Text', extensions: ['txt'] },
        { name: 'All Files', extensions: ['*'] },
      ];
  }
}

// ─── Text manipulation helpers ────────────────────────────────────
function wrapSelection(before, after) {
  const s = editor.selectionStart;
  const e = editor.selectionEnd;
  const selected = editor.value.substring(s, e);
  const replacement = before + (selected || 'text') + after;
  editor.setSelectionRange(s, e);
  document.execCommand('insertText', false, replacement);
  if (!selected) {
    editor.setSelectionRange(s + before.length, s + before.length + 4);
  }
  editor.focus();
}

function prefixLine(prefix) {
  const s = editor.selectionStart;
  const lineStart = editor.value.lastIndexOf('\n', s - 1) + 1;
  editor.setSelectionRange(lineStart, lineStart);
  document.execCommand('insertText', false, prefix);
  editor.focus();
}

function insertText(text) {
  const s = editor.selectionStart;
  editor.setSelectionRange(s, s);
  document.execCommand('insertText', false, text);
  editor.focus();
}

function insertLink() {
  const s = editor.selectionStart;
  const e = editor.selectionEnd;
  const selected = editor.value.substring(s, e);
  const text = selected || 'link text';
  insertText(`[${text}](url)`);
  if (!selected) {
    editor.setSelectionRange(s + text.length + 3, s + text.length + 6);
  }
}

function insertImage() {
  insertText('![alt](url)');
}

function insertTable() {
  insertText('\n| Header | Header |\n|--------|--------|\n| Cell   | Cell   |\n');
}

async function exportHtml() {
  try {
    const selected = await save({
      filters: [{ name: 'HTML', extensions: ['html'] }],
    });
    if (!selected) return;
    await invoke('export_html', { content: editor.value, path: selected });
    showAutoSaved('Exported');
  } catch (err) {
    console.error('Export error:', err);
  }
}

// ─── Status bar ──────────────────────────────────────────────────
function updateStatus() {
  const content = editor.value;
  const words = content.split(/\s+/).filter(w => w.length > 0).length;
  const chars = content.length;
  const lines = content.lines?.length || content.split('\n').length;
  const readTime = Math.max(1, Math.ceil(words / 200));

  if (status.words) status.words.textContent = `${words} words`;
  if (status.chars) status.chars.textContent = `${chars} chars`;
  if (status.lines) status.lines.textContent = `${lines} lines`;
  if (status.readTime) status.readTime.textContent = `~${readTime} min read`;
  if (status.file) status.file.textContent = currentPath || 'No file';
}

function updateTitle() {
  const name = currentPath ? currentPath.split(/[/\\]/).pop() : 'Untitled';
  const mod = isModified ? '● ' : '';
  if (fileTitle) fileTitle.textContent = mod + name;
  document.title = mod + name + ' — OneMarkdown';
}

function updateCursorPos() {
  const s = editor.selectionStart;
  const text = editor.value.substring(0, s);
  const lines = text.split('\n');
  const ln = lines.length;
  const col = lines[lines.length - 1].length + 1;
  if (status.cursor) status.cursor.textContent = `Ln ${ln}, Col ${col}`;
}

function showAutoSaved(msg) {
  if (status.saved) {
    status.saved.textContent = msg;
    status.saved.style.opacity = '1';
    setTimeout(() => { status.saved.style.opacity = '0'; }, 2000);
  }
}

// ─── Auto save ───────────────────────────────────────────────────
function scheduleAutoSave() {
  if (!currentPath) return;
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(async () => {
    try {
      await invoke('save_file', { content: editor.value });
      isModified = false;
      updateTitle();
      showAutoSaved('Auto-saved');
    } catch (err) {
      console.error('Auto-save error:', err);
    }
  }, 3000);
}

// ─── Search & Replace ────────────────────────────────────────────
function bindSearch() {
  const searchBar = $('#search-bar');
  const searchInput = $('#search-input');
  const replaceInput = $('#replace-input');
  const searchCount = $('#search-count');
  const searchRegex = $('#search-regex');
  const searchCase = $('#search-case');

  let matches = [];
  let currentMatch = -1;

  function doSearch() {
    const query = searchInput.value;
    if (!query) { matches = []; currentMatch = -1; searchCount.textContent = '0/0'; clearHighlights(); return; }

    const flags = searchCase.checked ? 'g' : 'gi';
    let re;
    try {
      re = searchRegex.checked ? new RegExp(query, flags) : new RegExp(escapeRegex(query), flags);
    } catch { return; }

    matches = [];
    let m;
    while ((m = re.exec(editor.value)) !== null) {
      matches.push({ start: m.index, end: m.index + m[0].length });
      if (matches.length > 10000) break;
    }

    currentMatch = matches.length > 0 ? 0 : -1;
    searchCount.textContent = `${matches.length > 0 ? currentMatch + 1 : 0}/${matches.length}`;
    highlightCurrentMatch();
  }

  function highlightCurrentMatch() {
    if (currentMatch < 0 || currentMatch >= matches.length) return;
    const m = matches[currentMatch];
    editor.focus();
    editor.setSelectionRange(m.start, m.end);
    // Scroll into view
    const lineHeight = parseInt(getComputedStyle(editor).lineHeight) || 20;
    const linesBefore = editor.value.substring(0, m.start).split('\n').length;
    editor.scrollTop = (linesBefore - 5) * lineHeight;
  }

  function clearHighlights() {
    // Nothing to clear in textarea mode
  }

  searchInput?.addEventListener('input', doSearch);
  searchRegex?.addEventListener('change', doSearch);
  searchCase?.addEventListener('change', doSearch);

  $('#search-next')?.addEventListener('click', () => {
    if (matches.length === 0) return;
    currentMatch = (currentMatch + 1) % matches.length;
    searchCount.textContent = `${currentMatch + 1}/${matches.length}`;
    highlightCurrentMatch();
  });

  $('#search-prev')?.addEventListener('click', () => {
    if (matches.length === 0) return;
    currentMatch = (currentMatch - 1 + matches.length) % matches.length;
    searchCount.textContent = `${currentMatch + 1}/${matches.length}`;
    highlightCurrentMatch();
  });

  $('#replace-one')?.addEventListener('click', () => {
    if (currentMatch < 0) return;
    const m = matches[currentMatch];
    const replacement = replaceInput.value;
    editor.setSelectionRange(m.start, m.end);
    document.execCommand('insertText', false, replacement);
    doSearch();
  });

  $('#replace-all')?.addEventListener('click', () => {
    if (matches.length === 0) return;
    const query = searchInput.value;
    const replacement = replaceInput.value;
    const flags = searchCase.checked ? 'g' : 'gi';
    let re;
    try {
      re = searchRegex.checked ? new RegExp(query, flags) : new RegExp(escapeRegex(query), flags);
    } catch { return; }
    editor.value = editor.value.replace(re, replacement);
    isModified = true;
    doSearch();
    renderPreview();
    updateStatus();
  });

  $('#search-close')?.addEventListener('click', () => {
    searchBar.classList.add('hidden');
    editor.focus();
  });

  // Expose toggle
  window.toggleSearch = () => {
    searchBar.classList.toggle('hidden');
    if (!searchBar.classList.contains('hidden')) {
      searchInput.focus();
      const sel = editor.value.substring(editor.selectionStart, editor.selectionEnd);
      if (sel) searchInput.value = sel;
      doSearch();
    }
  };

  window.toggleReplace = () => {
    searchBar.classList.toggle('hidden');
    const replaceRow = $('#replace-row');
    if (replaceRow) replaceRow.style.display = '';
    if (!searchBar.classList.contains('hidden')) {
      searchInput.focus();
    }
  };
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Recent files ────────────────────────────────────────────────
function bindRecent() {
  const panel = $('#recent-panel');
  const list = $('#recent-list');

  async function showRecent() {
    try {
      const files = await invoke('get_recent_files');
      list.innerHTML = '';
      if (files.length === 0) {
        list.innerHTML = '<div style="padding:12px;color:var(--text2)">No recent files</div>';
      } else {
        files.forEach(f => {
          const item = document.createElement('div');
          item.className = 'recent-item';
          const name = f.split(/[/\\]/).pop();
          item.innerHTML = `<span class="recent-name">${escapeHtml(name)}</span><span class="recent-path">${escapeHtml(f)}</span>`;
          item.addEventListener('click', async () => {
            panel.classList.add('hidden');
            if (isModified && !confirm('Unsaved changes. Continue?')) return;
            try {
              const info = await invoke('open_file', { path: f });
              editor.value = info.content;
              currentPath = info.path;
              isModified = false;
              const fileType = info.fileType || 'markdown';
              const language = info.language || 'markdown';
              setFileType(fileType, language);
              updateTitle();
              renderPreview();
              updateStatus();
              startFileWatcher(f);
            } catch (err) {
              console.error('Open recent error:', err);
            }
          });
          list.appendChild(item);
        });
      }
      panel.classList.toggle('hidden');
    } catch (err) {
      console.error('Recent files error:', err);
    }
  }

  $('#btn-recent')?.addEventListener('click', showRecent);
  $('#recent-close')?.addEventListener('click', () => panel.classList.add('hidden'));
}

// ─── Settings ────────────────────────────────────────────────────
function bindSettings() {
  const panel = $('#settings-panel');

  $('#btn-settings')?.addEventListener('click', () => {
    panel.classList.toggle('hidden');
  });

  $('#settings-close')?.addEventListener('click', () => {
    panel.classList.add('hidden');
  });

  $('#settings-save')?.addEventListener('click', async () => {
    const settings = {
      imageStrategy: $('#set-image-strategy').value,
      fontSize: parseInt($('#set-font-size').value) || 15,
      tabSize: parseInt($('#set-tab-size').value) || 4,
      wordWrap: $('#set-word-wrap').checked,
      autoSave: $('#set-auto-save').checked,
      aiEndpoint: $('#set-ai-endpoint').value,
      aiKey: $('#set-ai-key').value,
      aiModel: $('#set-ai-model').value,
      customCss: $('#set-custom-css').value,
      keybindings: customKeys,
      exportTemplate: '',
    };
    try {
      await invoke('save_settings', { settings });
      applySettings(settings);
      panel.classList.add('hidden');
    } catch (err) {
      console.error('Save settings error:', err);
    }
  });
}

async function loadSettingsIntoUI() {
  try {
    const settings = await invoke('get_settings');
    $('#set-font-size').value = settings.fontSize || 15;
    $('#set-tab-size').value = settings.tabSize || 4;
    $('#set-word-wrap').checked = settings.wordWrap !== false;
    $('#set-auto-save').checked = settings.autoSave !== false;
    $('#set-image-strategy').value = settings.imageStrategy || 'assetDir';
    $('#set-ai-endpoint').value = settings.aiEndpoint || '';
    $('#set-ai-key').value = settings.aiKey || '';
    $('#set-ai-model').value = settings.aiModel || '';
    $('#set-custom-css').value = settings.customCss || '';
    customKeys = settings.keybindings || {};
    applySettings(settings);
  } catch (err) {
    console.error('Load settings error:', err);
  }
}

function applySettings(settings) {
  editor.style.fontSize = (settings.fontSize || 15) + 'px';
  editor.style.tabSize = settings.tabSize || 4;
  editor.style.whiteSpace = settings.wordWrap !== false ? 'pre-wrap' : 'pre';
}

// ─── Resizer ─────────────────────────────────────────────────────
function bindResizer() {
  const resizer = $('#resizer');
  const editorPane = $('#editor-pane');
  const previewPane = $('#preview-pane');
  let isResizing = false;

  resizer?.addEventListener('mousedown', (e) => {
    isResizing = true;
    document.body.style.cursor = 'col-resize';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const main = $('#main');
    const rect = main.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    const clamped = Math.max(20, Math.min(80, pct));
    editorPane.style.width = clamped + '%';
    previewPane.style.width = (100 - clamped) + '%';
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      document.body.style.cursor = '';
    }
  });
}

// ─── Keyboard shortcuts ──────────────────────────────────────────
function bindShortcuts() {
  document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;

    if (ctrl && e.key === 'n') { e.preventDefault(); newFile(); }
    if (ctrl && e.key === 'o') { e.preventDefault(); openFile(); }
    if (ctrl && e.key === 's' && !e.shiftKey) { e.preventDefault(); saveFile(); }
    if (ctrl && e.key === 'S' && e.shiftKey) { e.preventDefault(); saveFileAs(); }
    if (ctrl && e.key === 'f') { e.preventDefault(); window.toggleSearch?.(); }
    if (ctrl && e.key === 'h') { e.preventDefault(); window.toggleReplace?.(); }
    if (ctrl && e.key === 'p') { e.preventDefault(); window.print(); }
    if (ctrl && e.key === 'm') { e.preventDefault(); togglePreviewMode(); }

    // Markdown-only shortcuts
    if (isMarkdownType()) {
      if (ctrl && e.key === 'b') { e.preventDefault(); wrapSelection('**', '**'); }
      if (ctrl && e.key === 'i') { e.preventDefault(); wrapSelection('*', '*'); }
      if (ctrl && e.key === 'k') { e.preventDefault(); insertLink(); }
      if (ctrl && e.key === 'e') { e.preventDefault(); wrapSelection('`', '`'); }
    }

    // Esc closes panels
    if (e.key === 'Escape') {
      $('#ai-panel')?.classList.add('hidden');
      $('#settings-panel')?.classList.add('hidden');
      $('#recent-panel')?.classList.add('hidden');
      $('#search-bar')?.classList.add('hidden');
    }
  });
}

// ─── Window close ────────────────────────────────────────────────
function bindWindowClose() {
  window.addEventListener('beforeunload', (e) => {
    if (isModified) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

// ─── Drag & Drop ─────────────────────────────────────────────────
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
    // For dropped files, we need to get the path
    // Tauri doesn't expose file paths from drag events directly,
    // so we read the content and detect type from the name
    if (isModified && !confirm('Unsaved changes. Continue?')) return;

    const reader = new FileReader();
    reader.onload = async () => {
      editor.value = reader.result;
      currentPath = ''; // Can't get path from drag
      isModified = false;

      // Detect type from filename
      const name = file.name;
      try {
        const [fileType, language] = await invoke('detect_file_type', { path: name });
        setFileType(fileType, language);
      } catch (e) {
        setFileType('text', 'plain text');
      }

      updateTitle();
      renderPreview();
      updateStatus();
    };
    reader.readAsText(file);
  });
}

// ─── File Watcher ────────────────────────────────────────────────
function bindFileWatcher() {
  listen('file-changed', async () => {
    if (!currentPath) return;
    if (confirm('File changed externally. Reload?')) {
      try {
        const info = await invoke('open_file', { path: currentPath });
        editor.value = info.content;
        isModified = false;
        const fileType = info.fileType || 'markdown';
        const language = info.language || 'markdown';
        setFileType(fileType, language);
        updateTitle();
        renderPreview();
        updateStatus();
      } catch (err) {
        console.error('Reload error:', err);
      }
    }
  });
}

async function startFileWatcher(path) {
  try {
    await invoke('start_watching', { path });
  } catch (err) {
    console.error('Watch error:', err);
  }
}

// ─── AI Panel ────────────────────────────────────────────────────
function bindAI() {
  const panel = $('#ai-panel');
  const actionsPanel = $('#ai-actions-panel');
  const chatPanel = $('#ai-chat-panel');
  const chatInput = $('#ai-chat-input');
  const chatMessages = $('#ai-chat-messages');

  $('#btn-ai')?.addEventListener('click', () => panel.classList.toggle('hidden'));
  $('#ai-close')?.addEventListener('click', () => panel.classList.add('hidden'));

  $('#ai-mode-actions')?.addEventListener('click', () => {
    actionsPanel.style.display = '';
    chatPanel.style.display = 'none';
    $('#ai-mode-actions').classList.add('tb-accent');
    $('#ai-mode-chat').classList.remove('tb-accent');
    aiChatMode = false;
  });

  $('#ai-mode-chat')?.addEventListener('click', () => {
    actionsPanel.style.display = 'none';
    chatPanel.style.display = 'flex';
    $('#ai-mode-chat').classList.add('tb-accent');
    $('#ai-mode-actions').classList.remove('tb-accent');
    aiChatMode = true;
    chatInput?.focus();
  });

  // AI action buttons
  document.querySelectorAll('.ai-btn[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action === 'fetch-url') {
        aiFetchUrl();
      } else {
        aiAction(action);
      }
    });
  });

  // AI stop
  $('#ai-stop')?.addEventListener('click', aiStop);

  // Chat send
  $('#ai-chat-send')?.addEventListener('click', aiChatSend);
  chatInput?.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      aiChatSend();
    }
  });

  // Chat stop
  $('#ai-chat-stop')?.addEventListener('click', aiStop);

  // Chat clear
  $('#ai-chat-clear')?.addEventListener('click', () => {
    aiChatHistory = [];
    chatMessages.innerHTML = '';
  });
}

async function aiAction(action) {
  const content = editor.value;
  if (!content.trim()) return;

  aiOutput.textContent = '';
  aiStatus.classList.remove('hidden');
  aiStreaming = true;
  aiStreamText = '';

  try {
    const streamKey = `ai_${action}_stream`;
    await invoke(streamKey, {
      content,
      onChunk: (chunk) => {
        aiStreamText += chunk;
        aiOutput.textContent = aiStreamText;
        aiOutput.scrollTop = aiOutput.scrollHeight;
      },
    });
  } catch (err) {
    aiOutput.textContent = `Error: ${err}`;
  } finally {
    aiStreaming = false;
    aiStatus.classList.add('hidden');
  }
}

async function aiChatSend() {
  const input = $('#ai-chat-input');
  const messages = $('#ai-chat-messages');
  const msg = input.value.trim();
  if (!msg) return;

  // Add user message
  aiChatHistory.push({ role: 'user', content: msg });
  const userDiv = document.createElement('div');
  userDiv.className = 'ai-chat-msg ai-chat-user';
  userDiv.textContent = msg;
  messages.appendChild(userDiv);
  input.value = '';

  // Add assistant placeholder
  const assistantDiv = document.createElement('div');
  assistantDiv.className = 'ai-chat-msg ai-chat-assistant';
  assistantDiv.textContent = '...';
  messages.appendChild(assistantDiv);
  messages.scrollTop = messages.scrollHeight;

  $('#ai-chat-status')?.classList.remove('hidden');
  aiStreaming = true;
  aiStreamText = '';

  try {
    await invoke('ai_chat_stream', {
      messages: aiChatHistory,
      onChunk: (chunk) => {
        aiStreamText += chunk;
        assistantDiv.textContent = aiStreamText;
        messages.scrollTop = messages.scrollHeight;
      },
    });
    aiChatHistory.push({ role: 'assistant', content: aiStreamText });
  } catch (err) {
    assistantDiv.textContent = `Error: ${err}`;
  } finally {
    aiStreaming = false;
    $('#ai-chat-status')?.classList.add('hidden');
  }
}

async function aiFetchUrl() {
  const url = prompt('Enter URL to fetch:');
  if (!url) return;
  try {
    const result = await invoke('ai_fetch_url', { url });
    aiOutput.textContent = result;
  } catch (err) {
    aiOutput.textContent = `Error: ${err}`;
  }
}

async function aiStop() {
  try {
    await invoke('ai_stream_cancel');
  } catch (err) {
    console.error('AI stop error:', err);
  }
  aiStreaming = false;
  aiStatus?.classList.add('hidden');
}

// ─── Utility ─────────────────────────────────────────────────────
function insertAtCursor(text) {
  const s = editor.selectionStart;
  editor.setSelectionRange(s, s);
  document.execCommand('insertText', false, text);
  editor.focus();
}
