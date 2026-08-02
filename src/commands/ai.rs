use crate::commands::editor::EditorState;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    stream: bool,
    max_tokens: u32,
}

#[derive(Debug, Serialize, Deserialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiResult {
    pub text: String,
    pub tokens_used: u32,
}

/// Generate a context bundle from the current document + optional referenced files.
/// This is the "AI context" feature — package your notes for AI consumption.
#[tauri::command]
pub fn ai_context_bundle(
    content: String,
    include_frontmatter: bool,
) -> Result<String, String> {
    let doc = crate::core::frontmatter::parse(&content);

    let mut bundle = String::new();
    bundle.push_str("# Context Bundle\n\n");

    if include_frontmatter {
        if let Some(title) = &doc.frontmatter.title {
            bundle.push_str(&format!("**Title:** {}\n", title));
        }
        if let Some(tags) = &doc.frontmatter.tags {
            bundle.push_str(&format!("**Tags:** {}\n", tags.join(", ")));
        }
        if let Some(desc) = &doc.frontmatter.description {
            bundle.push_str(&format!("**Description:** {}\n", desc));
        }
        bundle.push('\n');
    }

    bundle.push_str("## Document Content\n\n");
    bundle.push_str(&doc.body);

    Ok(bundle)
}

/// AI: Explain the selected text or entire document.
#[tauri::command]
pub fn ai_explain(
    text: String,
    context: Option<String>,
    state: tauri::State<Mutex<EditorState>>,
) -> Result<AiResult, String> {
    let prompt = format!(
        "Explain the following Markdown content clearly and concisely. \
         Use the same language as the input.\n\n{}",
        if let Some(ctx) = context {
            format!("Document context:\n{}\n\nSelected text to explain:\n{}", ctx, text)
        } else {
            format!("Text to explain:\n{}", text)
        }
    );
    call_ai(&prompt, &state)
}

/// AI: Rewrite / improve the selected text.
#[tauri::command]
pub fn ai_rewrite(
    text: String,
    instruction: String,
    state: tauri::State<Mutex<EditorState>>,
) -> Result<AiResult, String> {
    let prompt = format!(
        "Rewrite the following text according to the instruction. \
         Return ONLY the rewritten text, no explanation.\n\n\
         Instruction: {}\n\nText:\n{}",
        instruction, text
    );
    call_ai(&prompt, &state)
}

/// AI: Summarize the document.
#[tauri::command]
pub fn ai_summarize(
    content: String,
    max_sentences: Option<u32>,
    state: tauri::State<Mutex<EditorState>>,
) -> Result<AiResult, String> {
    let max = max_sentences.unwrap_or(5);
    let prompt = format!(
        "Summarize the following document in {} sentences or fewer. \
         Use the same language as the input.\n\n{}",
        max, content
    );
    call_ai(&prompt, &state)
}

/// AI: Translate the text to a target language.
#[tauri::command]
pub fn ai_translate(
    text: String,
    target_lang: String,
    state: tauri::State<Mutex<EditorState>>,
) -> Result<AiResult, String> {
    let prompt = format!(
        "Translate the following text to {}. \
         Return ONLY the translated text, no explanation.\n\n{}",
        target_lang, text
    );
    call_ai(&prompt, &state)
}

// ─── AI client ────────────────────────────────────────────────────────

fn call_ai(prompt: &str, state: &Mutex<EditorState>) -> Result<AiResult, String> {
    let s = state.lock().map_err(|e| e.to_string())?;
    let endpoint = s.settings.ai_endpoint.clone();
    let key = s.settings.ai_key.clone();
    let model = s.settings.ai_model.clone();

    if endpoint.is_empty() || key.is_empty() {
        return Err("AI not configured. Set your API endpoint and key in Settings.".into());
    }

    let url = format!("{}/chat/completions", endpoint.trim_end_matches('/'));

    let body = ChatRequest {
        model: model.clone(),
        messages: vec![ChatMessage {
            role: "user".into(),
            content: prompt.to_string(),
        }],
        stream: false,
        max_tokens: 2048,
    };

    // Use a blocking request since Tauri commands are sync
    let client = reqwest::blocking::Client::new();
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .map_err(|e| format!("AI request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body_text = resp.text().unwrap_or_default();
        return Err(format!("AI returned {}: {}", status, body_text));
    }

    let chat_resp: ChatResponse = resp
        .json()
        .map_err(|e| format!("Failed to parse AI response: {}", e))?;

    let text = chat_resp
        .choices
        .first()
        .map(|c| c.message.content.clone())
        .unwrap_or_default();

    Ok(AiResult {
        text,
        tokens_used: 0,
    })
}
