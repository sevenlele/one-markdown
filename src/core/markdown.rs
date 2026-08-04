use pulldown_cmark::{html, Options, Parser};
use std::sync::OnceLock;
use syntect::easy::HighlightLines;
use syntect::highlighting::ThemeSet;
use syntect::html::{styled_line_to_highlighted_html, IncludeBackground};
use syntect::parsing::SyntaxSet;
use syntect::util::LinesWithEndings;

// ─── Global caches (initialized once) ──────────────────────────────

static SYNTAX_SET: OnceLock<SyntaxSet> = OnceLock::new();
static THEME_SET: OnceLock<ThemeSet> = OnceLock::new();

fn ss() -> &'static SyntaxSet {
    SYNTAX_SET.get_or_init(SyntaxSet::load_defaults_newlines)
}

fn ts() -> &'static ThemeSet {
    THEME_SET.get_or_init(ThemeSet::load_defaults)
}

// ─── Public API ────────────────────────────────────────────────────

/// Render Markdown to HTML fragment with syntax-highlighted code blocks.
pub fn to_html(markdown: &str) -> String {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_FOOTNOTES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);
    options.insert(Options::ENABLE_HEADING_ATTRIBUTES);
    options.insert(Options::ENABLE_SMART_PUNCTUATION);

    let parser = Parser::new_ext(markdown, options);

    // Process code blocks with syntax highlighting
    let mut events: Vec<pulldown_cmark::Event> = Vec::new();
    let mut in_code = false;
    let mut code_lang = String::new();
    let mut code_buf = String::new();

    for event in parser {
        match event {
            pulldown_cmark::Event::Start(pulldown_cmark::Tag::CodeBlock(kind)) => {
                in_code = true;
                code_lang = match kind {
                    pulldown_cmark::CodeBlockKind::Fenced(lang) => lang.to_string(),
                    _ => String::new(),
                };
                code_buf.clear();
            }
            pulldown_cmark::Event::End(pulldown_cmark::Tag::CodeBlock(_)) if in_code => {
                in_code = false;
                let highlighted = highlight(&code_buf, &code_lang);
                let html = format!(
                    r#"<pre><code class="language-{}">{}</code></pre>"#,
                    code_lang, highlighted
                );
                events.push(pulldown_cmark::Event::Html(html.into()));
            }
            pulldown_cmark::Event::Text(ref t) if in_code => {
                code_buf.push_str(t);
            }
            _ if in_code => {}
            _ => events.push(event.to_owned()),
        }
    }

    // Pre-allocate based on input size
    let mut html_out = String::with_capacity(markdown.len() * 2);
    html::push_html(&mut html_out, events.into_iter());
    html_out
}

/// Generate a complete standalone HTML document for export.
pub fn to_standalone_html(markdown: &str, title: &str) -> String {
    let body = to_html(markdown);
    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<style>
:root {{
  --bg: #0d1117; --bg2: #161b22; --border: #30363d;
  --text: #c9d1d9; --text2: #8b949e; --accent: #58a6ff;
}}
* {{ margin:0; padding:0; box-sizing:border-box; }}
body {{
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  line-height: 1.7; max-width: 860px; margin: 0 auto;
  padding: 2rem; color: var(--text); background: var(--bg);
}}
h1,h2,h3,h4 {{ color:#e6edf3; margin-top:1.5em; margin-bottom:.5em; }}
h1 {{ font-size:2em; border-bottom:1px solid var(--border); padding-bottom:.3em; }}
h2 {{ font-size:1.5em; border-bottom:1px solid var(--border); padding-bottom:.3em; }}
a {{ color:var(--accent); text-decoration:none; }}
a:hover {{ text-decoration:underline; }}
code {{ background:var(--bg2); padding:.2em .4em; border-radius:3px; font-size:85%; }}
pre {{ background:var(--bg2); border-radius:6px; padding:1em; overflow-x:auto; border:1px solid var(--border); margin-bottom:1em; }}
pre code {{ background:transparent; padding:0; }}
blockquote {{ border-left:4px solid #3b82f6; padding:.5em 1em; color:var(--text2); margin:0 0 1em; }}
table {{ border-collapse:collapse; width:100%; margin:1em 0; }}
th,td {{ border:1px solid var(--border); padding:8px 12px; text-align:left; }}
th {{ background:var(--bg2); font-weight:600; }}
hr {{ border:none; border-top:1px solid var(--border); margin:2em 0; }}
img {{ max-width:100%; border-radius:6px; }}
ul.contains-task-list {{ list-style:none; padding-left:0; }}
strong {{ color:#e6edf3; }}
</style>
</head>
<body>{body}</body>
</html>"#
    )
}

// ─── Internal ──────────────────────────────────────────────────────

fn highlight(code: &str, lang: &str) -> String {
    let syntax = ss()
        .find_syntax_by_token(lang)
        .unwrap_or_else(|| ss().find_syntax_plain_text());
    let theme = &ts().themes["base16-ocean.dark"];
    let mut h = HighlightLines::new(syntax, theme);
    let mut out = String::with_capacity(code.len() * 2);

    for line in LinesWithEndings::from(code) {
        let ranges = h.highlight_line(line, ss()).unwrap_or_default();
        let line_html =
            styled_line_to_highlighted_html(&ranges, IncludeBackground::No).unwrap_or_default();
        out.push_str(&line_html);
    }
    out
}
