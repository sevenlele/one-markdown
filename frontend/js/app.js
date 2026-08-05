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
let aiStreaming = false;
let aiStreamText = '';

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

[toc]

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

## Math

Inline math: $E = mc^2$ and $\sum_{i=1}^{n} x_i = x_1 + x_2 + \cdots + x_n$

Block math:

$$\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}$$

$$\frac{n!}{k!(n-k)!} = \binom{n}{k}$$

## Callouts

> [!tip] Getting Started
> Callouts highlight important information with colored blocks and icons.

> [!warning]
> Be careful with unsaved changes!

> [!info] Supported types
> note, tip, warning, danger, info, question, example, quote, bug

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
    // Match [!type] or [!type] Title
    const match = text.match(/^\[!([a-zA-Z]+)\]\s*(.*)/);
    if (!match) return;

    const type = match[1].toLowerCase();
    const meta = CALLOUT_TYPES[type];
    if (!meta) return;

    const title = match[2] || meta.label;

    // Build callout div
    const callout = document.createElement('div');
    callout.className = 'callout callout-' + type;

    const header = document.createElement('div');
    header.className = 'callout-header';
    header.innerHTML = '<span class="callout-icon">' + meta.icon + '</span><span class="callout-title">' + escapeHtml(title) + '</span>';

    const body = document.createElement('div');
    body.className = 'callout-body';

    // Collect body content: all children after the first <p> (the [!type] line)
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
}

// ─── Footnotes processing ───────────────────────────────────────
function processFootnotes(container) {
  // Find footnote references: <sup><a href="#fn1">1</a></sup>
  // pulldown-cmark generates: <sup class="footnote-reference"><a href="#fn1">1</a></sup>
  // Also handle raw markdown: text[^1] rendered as sup with [^1]

  const refs = container.querySelectorAll('sup a[href^="#fn"]');
  if (refs.length === 0) return;

  // Find footnote definitions (usually at the bottom)
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

  // Build footnotes section
  const section = document.createElement('div');
  section.className = 'footnotes';
  section.innerHTML = '<hr><ol class="footnotes-list">' +
    fnDefs.map(fn =>
      `<li id="fn-${fn.id}">${fn.content} <a href="#fnref-${fn.id}" class="footnote-backref">↩</a></li>`
    ).join('') +
    '</ol>';

  // Remove original definitions
  fnDefs.forEach(fn => fn.element.remove());

  // Add footnotes section at the end
  container.appendChild(section);

  // Update references with proper IDs and links
  refs.forEach(ref => {
    const href = ref.getAttribute('href');
    const num = href.replace('#fn', '');
    ref.setAttribute('href', `#fn-${num}`);
    ref.parentElement.id = `fnref-${num}`;
  });
}

// ─── KaTeX math rendering ──────────────────────────────────────
function renderMath(element) {
  if (typeof katex === 'undefined') return; // KaTeX not yet loaded

  // Tags whose content must never be treated as math
  const SKIP_TAGS = new Set(['CODE', 'PRE', 'SCRIPT', 'STYLE', 'TEXTAREA', 'KATEX']);

  // Collect all text nodes outside skipped elements
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeValue.indexOf('$') === -1) return NodeFilter.FILTER_REJECT;
      let el = node.parentElement;
      while (el && el !== element) {
        if (SKIP_TAGS.has(el.tagName)) return NodeFilter.FILTER_REJECT;
        // Skip already-rendered KaTeX
        if (el.classList && el.classList.contains('katex')) return NodeFilter.FILTER_REJECT;
        el = el.parentElement;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  // Collect nodes first (walker is live and will break if we mutate)
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);

  for (const textNode of nodes) {
    const text = textNode.nodeValue;
    // Skip if no dollar signs left (may have been partially processed)
    if (text.indexOf('$') === -1) continue;

    // Build a regex that matches \$\$...\$\$ (block) or $...$ (inline)
    // but NOT \\$ (escaped dollars)
    // We process the whole string and collect replacements
    const re = /(\$\$)((?:[^$]|\\\$)+?)\1|(?<!\\)\$((?:[^$\n]|\\\$)+?)\$/g;
    let match;
    let lastIndex = 0;
    const fragments = [];
    let hasMath = false;

    while ((match = re.exec(text)) !== null) {
      hasMath = true;
      // Add text before this match
      if (match.index > lastIndex) {
        fragments.push(document.createTextNode(text.slice(lastIndex, match.index)));
      }

      const isBlock = match[1] === '$$';
      const raw = isBlock ? match[2] : match[3];
      // Unescape \$ to $
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
        // On error, leave the original text
        fragments.push(document.createTextNode(isBlock ? `$$${raw}$$` : `$${raw}$`));
      }

      lastIndex = match.index + match[0].length;
    }

    if (!hasMath) continue;

    // Remaining text after last match
    if (lastIndex < text.length) {
      fragments.push(document.createTextNode(text.slice(lastIndex)));
    }

    // Replace the original text node with fragments
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
/**
 * Slugify a string into a URL-safe ID.
 * Lowercase, strip non-alphanumerics (keep CJK), collapse hyphens.
 */
function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Find [toc] markers in the preview and replace them with a
 * clickable table of contents built from all h1–h6 headings.
 */
function generateTOC(container) {
  // Collect all headings (skip any inside <pre> / code blocks)
  const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6');
  const filtered = [];
  for (const h of headings) {
    if (h.closest('pre') || h.closest('code')) continue;
    filtered.push(h);
  }

  if (filtered.length === 0) return;

  // Assign unique IDs to every heading
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

  // Find [toc] markers — appear as <p>[toc]</p> (case-insensitive, trimmed)
  const tocMarkers = [];
  for (const el of container.children) {
    if (el.tagName === 'P' && el.textContent.trim().toLowerCase() === '[toc]') {
      tocMarkers.push(el);
    }
  }
  if (tocMarkers.length === 0) return;

  // Build nested list
  const tocNav = document.createElement('nav');
  tocNav.className = 'toc';
  tocNav.setAttribute('aria-label', 'Table of Contents');

  const tocTitle = document.createElement('div');
  tocTitle.className = 'toc-title';
  tocTitle.textContent = 'Table of Contents';
  tocNav.appendChild(tocTitle);

  const list = document.createElement('ul');
  list.className = 'toc-list';

  // Track nesting: stack of { level, ul } pairs
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

    // Pop back to the correct parent level
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

  // Replace each [toc] marker with the TOC (clone for multiples)
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
  $('#btn-ai-edit').onclick = showInlineAiEdit;
  $('#ai-close').onclick = () => {
    if (aiStreaming) stopAiStream();
    aiPanel.classList.add('hidden');
  };

  document.querySelectorAll('.ai-btn').forEach(btn => {
    if (btn.id === 'ai-stop') return; // handled separately
    btn.onclick = () => handleAiAction(btn.dataset.action);
  });

  aiStopBtn.onclick = stopAiStream;

  // Listen for streaming events from backend
  listen('ai-chunk', (event) => {
    if (!aiStreaming) return;
    aiStreamText += event.payload;
    aiOutput.textContent = aiStreamText;
    // Auto-scroll to bottom
    aiOutput.scrollTop = aiOutput.scrollHeight;
  });

  listen('ai-done', (event) => {
    if (!aiStreaming) return;
    aiStreaming = false;
    aiStatus.classList.add('hidden');
    if (event.payload === 'cancelled') {
      aiOutput.textContent = aiStreamText + '\n\n[Stream cancelled]';
    }
  });
}

function startAiStream() {
  aiStreaming = true;
  aiStreamText = '';
  aiOutput.textContent = '';
  aiStatus.classList.remove('hidden');
}

function stopAiStream() {
  if (!aiStreaming) return;
  invoke('ai_stream_cancel');
}

async function handleAiAction(action) {
  const sel = editor.value.substring(editor.selectionStart, editor.selectionEnd);
  const fullContent = editor.value;

  // Context bundle doesn't need streaming
  if (action === 'context') {
    aiOutput.textContent = '⏳ Loading...';
    try {
      const text = await invoke('ai_context_bundle', { content: fullContent, includeFrontmatter: true });
      aiOutput.textContent = text || '(empty)';
    } catch (err) {
      aiOutput.textContent = `❌ ${err}`;
    }
    return;
  }

  // Use streaming commands for AI actions
  startAiStream();

  try {
    switch (action) {
      case 'explain':
        await invoke('ai_explain_stream', { text: sel || fullContent, context: sel ? fullContent : null });
        break;
      case 'summarize':
        await invoke('ai_summarize_stream', { content: fullContent, maxSentences: 5 });
        break;
      case 'translate':
        const lang = prompt('Translate to:', 'English');
        if (!lang) { aiStreaming = false; aiStatus.classList.add('hidden'); return; }
        await invoke('ai_translate_stream', { text: sel || fullContent, targetLang: lang });
        break;
      case 'rewrite':
        const instr = prompt('How to rewrite?', 'Make it more concise and professional');
        if (!instr) { aiStreaming = false; aiStatus.classList.add('hidden'); return; }
        await invoke('ai_rewrite_stream', { text: sel || fullContent, instruction: instr });
        break;
    }
  } catch (err) {
    aiStreaming = false;
    aiStatus.classList.add('hidden');
    aiOutput.textContent = `❌ ${err}`;
  }
}

// Inline AI Edit - shows a small input near the selection
// ─── Inline AI Edit ───────────────────────────────────────────
let inlineAiBox = null;

function showInlineAiEdit() {
  const selStart = editor.selectionStart;
  const selEnd = editor.selectionEnd;
  const selText = editor.value.substring(selStart, selEnd);

  if (!selText.trim()) {
    flashEditorBorder('var(--red)');
    return;
  }

  removeInlineAiBox();

  // Calculate position near end of selection
  const pos = getCaretPixelPosition(editor, selEnd);

  // Create the inline box
  inlineAiBox = document.createElement('div');
  inlineAiBox.className = 'inline-ai-box';
  inlineAiBox.innerHTML = `
    <div class="inline-ai-header">✨ AI Edit <span style="font-weight:400;opacity:.6">(${selText.length} chars)</span></div>
    <div class="inline-ai-row">
      <input class="inline-ai-input" type="text"
        placeholder="e.g. make shorter, translate, fix grammar..."
        spellcheck="false" />
      <button class="inline-ai-go">Go</button>
      <button class="inline-ai-cancel" title="Cancel (Esc)">✕</button>
    </div>
    <div class="inline-ai-status"></div>
  `;

  document.body.appendChild(inlineAiBox);

  // Position — below the selection line, clamped to viewport
  const boxW = 360;
  const boxH = 90;
  let top = pos.top + 4;
  let left = Math.max(8, Math.min(pos.left, window.innerWidth - boxW - 8));
  if (top + boxH > window.innerHeight - 30) {
    top = pos.top - boxH - 4; // flip above
  }
  if (top < 44) top = 44; // below toolbar
  inlineAiBox.style.top = top + 'px';
  inlineAiBox.style.left = left + 'px';

  const input = inlineAiBox.querySelector('.inline-ai-input');
  const goBtn = inlineAiBox.querySelector('.inline-ai-go');
  const cancelBtn = inlineAiBox.querySelector('.inline-ai-cancel');
  const statusEl = inlineAiBox.querySelector('.inline-ai-status');

  input.focus();

  // ── Rewrite handler ──
  async function doRewrite() {
    const instruction = input.value.trim();
    if (!instruction) { input.focus(); return; }

    input.disabled = true;
    goBtn.disabled = true;
    statusEl.innerHTML = '<span class="ai-streaming-indicator"></span> Rewriting…';

    try {
      const result = await invoke('ai_rewrite', { text: selText, instruction });

      // Replace selection preserving undo history
      editor.focus();
      editor.setSelectionRange(selStart, selEnd);
      document.execCommand('insertText', false, result.text);

      removeInlineAiBox();
      flashEditorBorder('var(--green)');
    } catch (err) {
      statusEl.textContent = '❌ ' + err;
      input.disabled = false;
      goBtn.disabled = false;
      input.focus();
    }
  }

  goBtn.onclick = doRewrite;

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doRewrite(); }
    if (e.key === 'Escape') { e.preventDefault(); removeInlineAiBox(); editor.focus(); }
  });

  cancelBtn.onclick = () => { removeInlineAiBox(); editor.focus(); };

  // Close on outside click (mousedown so it fires before focus shifts)
  setTimeout(() => {
    document.addEventListener('mousedown', onOutsideClick);
  }, 0);
}

function onOutsideClick(e) {
  if (inlineAiBox && !inlineAiBox.contains(e.target)) {
    removeInlineAiBox();
    document.removeEventListener('mousedown', onOutsideClick);
  }
}

function removeInlineAiBox() {
  document.removeEventListener('mousedown', onOutsideClick);
  if (inlineAiBox) {
    inlineAiBox.remove();
    inlineAiBox = null;
  }
}

function flashEditorBorder(color) {
  editor.style.boxShadow = `inset 0 0 0 2px ${color}`;
  setTimeout(() => { editor.style.boxShadow = ''; }, 400);
}

/**
 * Approximate pixel position of a caret offset inside a textarea.
 * Works well for monospace fonts (the editor uses JetBrains Mono).
 */
function getCaretPixelPosition(textarea, offset) {
  const text = textarea.value.substring(0, offset);
  const lines = text.split('\n');
  const lineIdx = lines.length - 1;
  const colIdx = lines[lineIdx].length;

  const cs = getComputedStyle(textarea);
  const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.7;
  const paddingTop = parseFloat(cs.paddingTop);
  const paddingLeft = parseFloat(cs.paddingLeft);
  const borderTop = parseFloat(cs.borderTopWidth);
  const borderLeft = parseFloat(cs.borderLeftWidth);

  // Monospace char width ≈ fontSize * 0.6
  const charWidth = parseFloat(cs.fontSize) * 0.6;

  const rect = textarea.getBoundingClientRect();

  return {
    top: rect.top + borderTop + paddingTop + lineIdx * lineHeight - textarea.scrollTop,
    left: rect.left + borderLeft + paddingLeft + colIdx * charWidth,
  };
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
      case 'L': e.preventDefault(); showInlineAiEdit(); break;
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
