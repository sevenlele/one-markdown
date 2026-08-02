// OneMarkdown — Open, write, publish.
// One file is all you need.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod core {
    pub mod frontmatter;
    pub mod markdown;
    pub mod assets;
    pub mod watcher;
}

mod commands {
    pub mod editor;
    pub mod ai;
}

use std::sync::Mutex;
use commands::editor::EditorState;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(Mutex::new(EditorState::new()))
        .invoke_handler(tauri::generate_handler![
            // File operations
            commands::editor::open_file,
            commands::editor::save_file,
            commands::editor::save_file_as,
            commands::editor::new_file,
            commands::editor::get_recent_files,
            commands::editor::export_html,
            // Markdown
            commands::editor::render_markdown,
            // Image paste
            commands::editor::save_pasted_image,
            // AI
            commands::ai::ai_explain,
            commands::ai::ai_rewrite,
            commands::ai::ai_summarize,
            commands::ai::ai_translate,
            commands::ai::ai_context_bundle,
            // AI streaming
            commands::ai::ai_explain_stream,
            commands::ai::ai_summarize_stream,
            commands::ai::ai_translate_stream,
            commands::ai::ai_rewrite_stream,
            commands::ai::ai_stream_cancel,
            // Settings
            commands::editor::get_settings,
            commands::editor::save_settings,
            // External change detection
            commands::editor::check_external_change,
            commands::editor::start_watching,
            commands::editor::stop_watching,
        ])
        .run(tauri::generate_context!())
        .expect("OneMarkdown failed to start");
}
