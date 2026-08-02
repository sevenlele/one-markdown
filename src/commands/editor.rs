use crate::core::{assets, frontmatter, markdown};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

// ─── State ────────────────────────────────────────────────────────────

pub struct EditorState {
    pub current_path: Option<PathBuf>,
    pub content: String,
    pub recent_files: Vec<PathBuf>,
    pub settings: Settings,
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
        }
    }
}

impl EditorState {
    pub fn new() -> Self {
        let settings = load_settings();
        Self {
            current_path: None,
            content: String::new(),
            recent_files: load_recent_files(),
            settings,
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

#[tauri::command]
pub fn open_file(path: String, state: tauri::State<Mutex<EditorState>>) -> Result<FileInfo, String> {
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let doc = frontmatter::parse(&content);
    let path_buf = PathBuf::from(&path);
    let name = path_buf
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "Untitled".into());

    let mut s = state.lock().map_err(|e| e.to_string())?;
    s.current_path = Some(path_buf.clone());
    s.content = content.clone();

    // Update recent files (MRU order)
    s.recent_files.retain(|p| p != &path_buf);
    s.recent_files.insert(0, path_buf);
    s.recent_files.truncate(20);
    save_recent_files(&s.recent_files);

    Ok(FileInfo {
        path,
        name,
        content,
        frontmatter: doc.frontmatter,
        modified: false,
    })
}

#[tauri::command]
pub fn save_file(content: String, state: tauri::State<Mutex<EditorState>>) -> Result<String, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    if let Some(path) = &s.current_path {
        fs::write(path, &content).map_err(|e| e.to_string())?;
        s.content = content;
        Ok(path.to_string_lossy().to_string())
    } else {
        Err("No file open — use save_file_as".into())
    }
}

#[tauri::command]
pub fn save_file_as(
    path: String,
    content: String,
    state: tauri::State<Mutex<EditorState>>,
) -> Result<String, String> {
    let path_buf = PathBuf::from(&path);
    fs::write(&path_buf, &content).map_err(|e| e.to_string())?;

    let mut s = state.lock().map_err(|e| e.to_string())?;
    s.current_path = Some(path_buf.clone());
    s.content = content;
    s.recent_files.retain(|p| p != &path_buf);
    s.recent_files.insert(0, path_buf);
    save_recent_files(&s.recent_files);

    Ok(path)
}

#[tauri::command]
pub fn new_file(state: tauri::State<Mutex<EditorState>>) -> Result<FileInfo, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    s.current_path = None;
    s.content = String::new();
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
    Ok(s.recent_files.iter().map(|p| p.to_string_lossy().to_string()).collect())
}

#[tauri::command]
pub fn export_html(content: String, path: String) -> Result<String, String> {
    let doc = frontmatter::parse(&content);
    let title = doc
        .frontmatter
        .title
        .unwrap_or_else(|| {
            PathBuf::from(&path)
                .file_stem()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "Document".into())
        });
    let html = markdown::to_standalone_html(&doc.body, &title);
    fs::write(&path, &html).map_err(|e| e.to_string())?;
    Ok(path)
}

#[tauri::command]
pub fn save_pasted_image(
    image_data: String,
    mime_type: String,
    state: tauri::State<Mutex<EditorState>>,
) -> Result<assets::SavedImage, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&image_data)
        .map_err(|e| e.to_string())?;

    let s = state.lock().map_err(|e| e.to_string())?;
    let doc_path = s.current_path.as_ref().map(|p| p.to_string_lossy().to_string());
    let strategy = s.settings.image_strategy.clone();

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
    s.settings = settings.clone();
    save_settings_to_disk(&settings);
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
    let paths: Vec<String> = files.iter().map(|p| p.to_string_lossy().to_string()).collect();
    let _ = fs::write(dir.join("recent.json"), serde_json::to_string(&paths).unwrap_or_default());
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
