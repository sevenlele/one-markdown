use crate::core::{assets, frontmatter, markdown, watcher};
use anyhow::Result;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::fs;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{mpsc, Mutex};
use std::thread;
use tauri::Emitter;

// ─── State ────────────────────────────────────────────────────────────

pub struct EditorState {
    pub current_path: Option<PathBuf>,
    pub recent_files: Vec<PathBuf>,
    pub settings: Settings,
    pub watch_stop: Option<std::sync::mpsc::Sender<()>>,
    pub _watcher: Option<watcher::FileWatcher>,
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

    Ok(FileInfo {
        path,
        name,
        content,
        frontmatter: doc.frontmatter,
        modified: false,
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
    })
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
pub async fn export_html(content: String, path: String) -> Result<String, String> {
    let doc = frontmatter::parse(&content);
    let title = doc.frontmatter.title.unwrap_or_else(|| {
        PathBuf::from(&path)
            .file_stem()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "Document".into())
    });
    let html = markdown::to_standalone_html(&doc.body, &title);
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
    fs::read_to_string(&path)
        .ok()
        .and_then(|d| serde_json::from_str(&d).ok())
        .unwrap_or_default()
}

fn save_settings_to_disk(settings: &Settings) {
    let dir = config_dir();
    let _ = fs::create_dir_all(&dir);
    let _ = fs::write(
        dir.join("settings.json"),
        serde_json::to_string_pretty(settings).unwrap_or_default(),
    );
}
