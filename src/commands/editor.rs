use crate::core::{assets, frontmatter, markdown, watcher};
use anyhow::Result;
use base64::Engine;
use sha2::{Digest, Sha256};
use serde::{Deserialize, Serialize};
use std::fs;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{mpsc, Mutex};
use std::thread;
use tauri::Emitter;
use std::ffi::OsStr;

// ─── File Type Detection ─────────────────────────────────────────────

/// File type classification for multi-format support.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FileType {
    Markdown,
    Code,
    Text,
    Json,
    Yaml,
    Csv,
    Html,
    Xml,
    Toml,
}

impl Default for FileType {
    fn default() -> Self {
        FileType::Markdown
    }
}

impl FileType {
    pub fn from_extension(ext: &str) -> Self {
        match ext.to_lowercase().as_str() {
            "md" | "markdown" | "mdx" => FileType::Markdown,
            "json" | "jsonc" | "json5" => FileType::Json,
            "yml" | "yaml" => FileType::Yaml,
            "csv" | "tsv" => FileType::Csv,
            "html" | "htm" | "xhtml" => FileType::Html,
            "xml" | "svg" | "xsl" | "xsd" | "rss" | "atom" => FileType::Xml,
            "toml" => FileType::Toml,
            "txt" | "log" | "ini" | "cfg" | "conf" | "env" | "gitignore"
            | "dockerignore" | "editorconfig" => FileType::Text,
            "rs" | "py" | "js" | "ts" | "jsx" | "tsx" | "go" | "java" | "c"
            | "cpp" | "h" | "hpp" | "cs" | "rb" | "php" | "swift" | "kt"
            | "scala" | "r" | "lua" | "pl" | "pm" | "sh" | "bash" | "zsh"
            | "fish" | "ps1" | "bat" | "cmd" | "sql" | "graphql" | "proto"
            | "dart" | "zig" | "nim" | "ex" | "exs" | "erl" | "hs"
            | "ml" | "clj" | "cljs" | "lisp" | "el" | "jl" | "m" | "mm"
            | "vue" | "svelte" | "astro" | "css" | "scss" | "sass" | "less" => FileType::Code,
            _ => FileType::Text,
        }
    }

    pub fn from_path(path: &str) -> Self {
        let p = PathBuf::from(path);
        let ext = p.extension().and_then(OsStr::to_str).unwrap_or("");
        let name = p.file_name().and_then(OsStr::to_str).unwrap_or("");
        match name {
            "Makefile" | "CMakeLists.txt" | "Dockerfile" | "Vagrantfile"
            | "Rakefile" | "Gemfile" | "Podfile" => FileType::Code,
            _ => Self::from_extension(ext),
        }
    }

    pub fn syntax_token(path: &str) -> &str {
        let ext = PathBuf::from(path)
            .extension()
            .and_then(OsStr::to_str)
            .unwrap_or("")
            .to_lowercase();
        match ext.as_str() {
            "rs" => "rust", "py" => "python", "js" | "mjs" | "cjs" => "javascript",
            "ts" | "mts" | "cts" => "typescript", "jsx" => "jsx", "tsx" => "tsx",
            "go" => "go", "java" => "java", "c" | "h" => "c",
            "cpp" | "cc" | "hpp" => "c++", "cs" => "c#", "rb" => "ruby",
            "php" => "php", "swift" => "swift", "kt" | "kts" => "kotlin",
            "scala" => "scala", "r" => "r", "lua" => "lua",
            "pl" | "pm" => "perl", "sh" | "bash" | "zsh" => "bash",
            "fish" => "fish", "ps1" => "powershell", "bat" | "cmd" => "batchfile",
            "sql" => "sql", "graphql" | "gql" => "graphql", "proto" => "protobuf",
            "dart" => "dart", "zig" => "zig", "nim" => "nim",
            "ex" | "exs" => "elixir", "erl" => "erlang", "hs" => "haskell",
            "ml" | "mli" => "ocaml", "clj" | "cljs" => "clojure",
            "lisp" => "lisp", "el" => "emacs lisp", "jl" => "julia",
            "m" | "mm" => "objective-c", "vue" => "vue", "svelte" => "svelte",
            "css" => "css", "scss" | "sass" => "scss", "less" => "less",
            "json" | "jsonc" => "json", "yml" | "yaml" => "yaml",
            "toml" => "toml", "xml" | "svg" => "xml",
            "html" | "htm" => "html", "csv" | "tsv" => "csv",
            "md" | "markdown" => "markdown", "dockerfile" => "dockerfile",
            _ => "plain text",
        }
    }

    #[allow(dead_code)]
    pub fn is_markdown(&self) -> bool {
        matches!(self, FileType::Markdown)
    }
}

// ─── State ────────────────────────────────────────────────────────────

pub struct EditorState {
    pub current_path: Option<PathBuf>,
    pub recent_files: Vec<PathBuf>,
    pub settings: Settings,
    pub watch_stop: Option<std::sync::mpsc::Sender<()>>,
    pub _watcher: Option<watcher::FileWatcher>,
    pub ai_stats: AiStats,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStats {
    pub total_calls: u32,
    pub total_prompt_tokens: u32,
    pub total_response_tokens: u32,
    pub calls_by_action: std::collections::HashMap<String, u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub image_strategy: assets::ImageStrategy,
    pub font_size: u32,
    pub tab_size: u32,
    pub word_wrap: bool,
    pub auto_save: bool,
    pub ai_endpoint: String,
    pub ai_key: String,
    pub ai_model: String,
    #[serde(default)]
    pub keybindings: HashMap<String, String>,
    #[serde(default)]
    pub custom_css: String,
    #[serde(default)]
    pub export_template: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            image_strategy: assets::ImageStrategy::AssetDir,
            font_size: 15,
            tab_size: 4,
            word_wrap: true,
            auto_save: true,
            ai_endpoint: String::new(),
            ai_key: String::new(),
            ai_model: String::new(),
            keybindings: HashMap::new(),
            custom_css: String::new(),
            export_template: String::new(),
        }
    }
}

impl EditorState {
    pub fn new() -> Self {
        let settings = load_settings();
        Self {
            current_path: None,
            recent_files: load_recent_files(),
            settings,
            watch_stop: None,
            _watcher: None,
            ai_stats: AiStats::default(),
        }
    }
}

// ─── Data types ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub path: String,
    pub name: String,
    pub content: String,
    pub frontmatter: frontmatter::Frontmatter,
    pub modified: bool,
    #[serde(default)]
    pub file_type: FileType,
    #[serde(default)]
    pub language: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderResult {
    pub html: String,
    pub word_count: usize,
    pub char_count: usize,
    pub line_count: usize,
}

// ─── Commands ─────────────────────────────────────────────────────────

/// Stateless — no mutex, no I/O, just pure computation.
#[tauri::command]
pub fn render_markdown(content: String) -> Result<RenderResult, String> {
    let doc = frontmatter::parse(&content);
    let html = markdown::to_html(&doc.body);

    let word_count = doc.body.split_whitespace().count();
    let char_count = doc.body.chars().count();
    let line_count = doc.body.lines().count();

    Ok(RenderResult {
        html,
        word_count,
        char_count,
        line_count,
    })
}

/// Async — file I/O doesn't block the UI thread.
#[tauri::command]
pub async fn open_file(
    path: String,
    state: tauri::State<'_, Mutex<EditorState>>,
) -> Result<FileInfo, String> {
    let content = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| e.to_string())?;
    let doc = frontmatter::parse(&content);
    let path_buf = PathBuf::from(&path);
    let name = path_buf
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "Untitled".into());

    let mut s = state.lock().map_err(|e| e.to_string())?;

    // Update recent files (MRU order)
    s.recent_files.retain(|p| p != &path_buf);
    s.recent_files.insert(0, path_buf.clone());
    s.recent_files.truncate(20);
    save_recent_files(&s.recent_files);

    s.current_path = Some(path_buf);

    let file_type = FileType::from_path(&path);
    let language = FileType::syntax_token(&path).to_string();

    Ok(FileInfo {
        path,
        name,
        content,
        frontmatter: doc.frontmatter,
        modified: false,
        file_type,
        language,
    })
}

/// Render code content with syntax highlighting (for non-markdown files).
#[tauri::command]
pub fn render_code(content: String, language: String) -> Result<RenderResult, String> {
    let html = markdown::highlight_code(&content, &language);
    let wrapped_html = format!(
        r#"<pre class="code-preview"><code class="language-{}">{}</code></pre>"#,
        language, html
    );

    let word_count = content.split_whitespace().count();
    let char_count = content.chars().count();
    let line_count = content.lines().count();

    Ok(RenderResult {
        html: wrapped_html,
        word_count,
        char_count,
        line_count,
    })
}

/// Async — file I/O doesn't block the UI thread.
#[tauri::command]
pub async fn save_file(
    content: String,
    state: tauri::State<'_, Mutex<EditorState>>,
) -> Result<String, String> {
    let path = {
        let s = state.lock().map_err(|e| e.to_string())?;
        s.current_path
            .as_ref()
            .map(|p| p.to_string_lossy().to_string())
            .ok_or_else(|| "No file open — use save_file_as".to_string())?
    };

    tokio::fs::write(&path, &content)
        .await
        .map_err(|e| e.to_string())?;
    Ok(path)
}

/// Async — file I/O doesn't block the UI thread.
#[tauri::command]
pub async fn save_file_as(
    path: String,
    content: String,
    state: tauri::State<'_, Mutex<EditorState>>,
) -> Result<String, String> {
    let path_buf = PathBuf::from(&path);
    tokio::fs::write(&path_buf, &content)
        .await
        .map_err(|e| e.to_string())?;

    let mut s = state.lock().map_err(|e| e.to_string())?;
    s.recent_files.retain(|p| p != &path_buf);
    s.recent_files.insert(0, path_buf.clone());
    save_recent_files(&s.recent_files);
    s.current_path = Some(path_buf);

    Ok(path)
}

#[tauri::command]
pub fn new_file(state: tauri::State<Mutex<EditorState>>) -> Result<FileInfo, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    s.current_path = None;
    Ok(FileInfo {
        path: String::new(),
        name: "Untitled".into(),
        content: String::new(),
        frontmatter: frontmatter::Frontmatter::default(),
        modified: false,
        file_type: FileType::Markdown,
        language: "markdown".into(),
    })
}

/// Detect file type from path without opening the file.
#[tauri::command]
pub fn detect_file_type(path: String) -> Result<(FileType, String), String> {
    let ft = FileType::from_path(&path);
    let lang = FileType::syntax_token(&path).to_string();
    Ok((ft, lang))
}

#[tauri::command]
pub fn get_recent_files(state: tauri::State<Mutex<EditorState>>) -> Result<Vec<String>, String> {
    let s = state.lock().map_err(|e| e.to_string())?;
    Ok(s
        .recent_files
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect())
}

/// Async — export can be slow for large docs.
#[tauri::command]
pub async fn export_html(
    content: String,
    path: String,
    state: tauri::State<'_, Mutex<EditorState>>,
) -> Result<String, String> {
    let doc = frontmatter::parse(&content);
    let title = doc.frontmatter.title.unwrap_or_else(|| {
        PathBuf::from(&path)
            .file_stem()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "Document".into())
    });
    let custom_css = {
        let s = state.lock().map_err(|e| e.to_string())?;
        s.settings.custom_css.clone()
    };
    let html = markdown::to_standalone_html(&doc.body, &title, &custom_css);
    tokio::fs::write(&path, &html)
        .await
        .map_err(|e| e.to_string())?;
    Ok(path)
}

/// Async — image I/O.
#[tauri::command]
pub async fn save_pasted_image(
    image_data: String,
    mime_type: String,
    state: tauri::State<'_, Mutex<EditorState>>,
) -> Result<assets::SavedImage, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&image_data)
        .map_err(|e| e.to_string())?;

    let (doc_path, strategy) = {
        let s = state.lock().map_err(|e| e.to_string())?;
        let doc_path = s
            .current_path
            .as_ref()
            .map(|p| p.to_string_lossy().to_string());
        let strategy = s.settings.image_strategy.clone();
        (doc_path, strategy)
    };

    assets::save_image(&bytes, &mime_type, doc_path.as_deref(), &strategy)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_settings(state: tauri::State<Mutex<EditorState>>) -> Result<Settings, String> {
    let s = state.lock().map_err(|e| e.to_string())?;
    Ok(s.settings.clone())
}

#[tauri::command]
pub fn get_ai_stats(state: tauri::State<Mutex<EditorState>>) -> Result<AiStats, String> {
    let s = state.lock().map_err(|e| e.to_string())?;
    Ok(s.ai_stats.clone())
}

#[tauri::command]
pub fn record_ai_usage(
    action: String,
    prompt_tokens: u32,
    response_tokens: u32,
    state: tauri::State<Mutex<EditorState>>,
) -> Result<(), String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    s.ai_stats.total_calls += 1;
    s.ai_stats.total_prompt_tokens += prompt_tokens;
    s.ai_stats.total_response_tokens += response_tokens;
    *s.ai_stats.calls_by_action.entry(action).or_insert(0) += 1;
    Ok(())
}

#[tauri::command]
pub fn save_settings(
    settings: Settings,
    state: tauri::State<Mutex<EditorState>>,
) -> Result<(), String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    save_settings_to_disk(&settings);
    s.settings = settings;
    Ok(())
}

/// Check if the file has been modified externally and return updated content if so.
#[tauri::command]
pub async fn check_external_change(
    path: String,
    known_mtime_ms: u64,
) -> Result<Option<String>, String> {
    let meta = tokio::fs::metadata(&path)
        .await
        .map_err(|e| e.to_string())?;
    let mtime = meta
        .modified()
        .map_err(|e| e.to_string())?
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    if mtime > known_mtime_ms {
        let content = tokio::fs::read_to_string(&path)
            .await
            .map_err(|e| e.to_string())?;
        Ok(Some(content))
    } else {
        Ok(None)
    }
}

/// Start watching the current file for external changes.
/// Emits a "file-changed" event to the frontend when the file is modified externally.
#[tauri::command]
pub fn start_watching(
    path: String,
    app: tauri::AppHandle,
    state: tauri::State<Mutex<EditorState>>,
) -> Result<(), String> {
    // Stop any existing watcher
    {
        let mut s = state.lock().map_err(|e| e.to_string())?;
        if let Some(tx) = s.watch_stop.take() {
            let _ = tx.send(());
        }
        s._watcher = None;
    }

    let (file_watcher, rx) = watcher::FileWatcher::watch(&path)
        .map_err(|e| format!("Watch error: {}", e))?;

    let (stop_tx, stop_rx) = std::sync::mpsc::channel::<()>();

    // Store watcher and stop signal in state
    {
        let mut s = state.lock().map_err(|e| e.to_string())?;
        s._watcher = Some(file_watcher);
        s.watch_stop = Some(stop_tx);
    }

    // Spawn a thread to listen for file changes and emit events
    thread::spawn(move || {
        loop {
            if stop_rx.try_recv().is_ok() {
                break;
            }
            match rx.recv_timeout(std::time::Duration::from_millis(500)) {
                Ok(_changed_path) => {
                    let _ = app.emit("file-changed", ());
                }
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    });

    Ok(())
}

/// Stop watching the current file.
#[tauri::command]
pub fn stop_watching(state: tauri::State<Mutex<EditorState>>) -> Result<(), String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    if let Some(tx) = s.watch_stop.take() {
        let _ = tx.send(());
    }
    s._watcher = None;
    Ok(())
}

// ─── Persistence helpers ──────────────────────────────────────────────

fn config_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("one-markdown")
}

fn load_recent_files() -> Vec<PathBuf> {
    let path = config_dir().join("recent.json");
    fs::read_to_string(&path)
        .ok()
        .and_then(|d| serde_json::from_str::<Vec<String>>(&d).ok())
        .map(|v| v.into_iter().map(PathBuf::from).collect())
        .unwrap_or_default()
}

fn save_recent_files(files: &[PathBuf]) {
    let dir = config_dir();
    let _ = fs::create_dir_all(&dir);
    let paths: Vec<String> = files
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect();
    let _ = fs::write(
        dir.join("recent.json"),
        serde_json::to_string(&paths).unwrap_or_default(),
    );
}

fn load_settings() -> Settings {
    let path = config_dir().join("settings.json");
    let mut settings: Settings = fs::read_to_string(&path)
        .ok()
        .and_then(|d| serde_json::from_str(&d).ok())
        .unwrap_or_default();
    // Decrypt API key if encrypted
    if settings.ai_key.starts_with("enc:") {
        settings.ai_key = decrypt_key(&settings.ai_key);
    }
    settings
}

fn save_settings_to_disk(settings: &Settings) {
    let dir = config_dir();
    let _ = fs::create_dir_all(&dir);
    let mut to_save = settings.clone();
    // Encrypt API key before saving
    if !to_save.ai_key.is_empty() {
        to_save.ai_key = encrypt_key(&to_save.ai_key);
    }
    let _ = fs::write(
        dir.join("settings.json"),
        serde_json::to_string_pretty(&to_save).unwrap_or_default(),
    );
}

// ─── API Key encryption (XOR with machine-derived key) ─────────────

fn machine_key() -> Vec<u8> {
    let home = dirs::home_dir().map(|h| h.to_string_lossy().to_string()).unwrap_or_default();
    let username = std::env::var("USER").or_else(|_| std::env::var("USERNAME")).unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(b"onemarkdown-salt-v1");
    hasher.update(home.as_bytes());
    hasher.update(username.as_bytes());
    hasher.finalize().to_vec()
}

fn encrypt_key(plaintext: &str) -> String {
    if plaintext.is_empty() || plaintext.starts_with("enc:") {
        return plaintext.to_string();
    }
    let key = machine_key();
    let encrypted: Vec<u8> = plaintext
        .bytes()
        .enumerate()
        .map(|(i, b)| b ^ key[i % key.len()])
        .collect();
    format!("enc:{}", hex::encode(&encrypted))
}

fn decrypt_key(stored: &str) -> String {
    let hex_str = match stored.strip_prefix("enc:") {
        Some(h) => h,
        None => return stored.to_string(),
    };
    let encrypted = match hex::decode(hex_str) {
        Ok(v) => v,
        Err(_) => return stored.to_string(),
    };
    let key = machine_key();
    let decrypted: Vec<u8> = encrypted
        .iter()
        .enumerate()
        .map(|(i, &b)| b ^ key[i % key.len()])
        .collect();
    String::from_utf8(decrypted).unwrap_or_default()
}

// Simple hex encode/decode (avoid adding another dependency)
mod hex {
    pub fn encode(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{:02x}", b)).collect()
    }
    pub fn decode(hex: &str) -> Result<Vec<u8>, String> {
        if hex.len() % 2 != 0 {
            return Err("Invalid hex length".into());
        }
        (0..hex.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).map_err(|e| e.to_string()))
            .collect()
    }
}
