use crate::commands::editor::EditorState;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};

// ─── Shared HTTP client (initialized once) ──────────────────────────

static HTTP_CLIENT: OnceLock<Client> = OnceLock::new();

fn client() -> &'static Client {
    HTTP_CLIENT.get_or_init(|| {
        Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .expect("Failed to create HTTP client")
    })
}

// ─── Request/Response types ─────────────────────────────────────────

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

// ─── Commands ───────────────────────────────────────────────────────

/// Generate a context bundle from the current document.
#[tauri::command]
pub fn ai_context_bundle(content: String, include_frontmatter: bool) -> Result<String, String> {
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
pub async fn ai_explain(
    text: String,
    context: Option<String>,
    state: tauri::State<'_, Mutex<EditorState>>,
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
    call_ai(&prompt, &state).await
}

/// AI: Rewrite / improve the selected text.
#[tauri::command]
pub async fn ai_rewrite(
    text: String,
    instruction: String,
    state: tauri::State<'_, Mutex<EditorState>>,
) -> Result<AiResult, String> {
    let prompt = format!(
        "Rewrite the following text according to the instruction. \
         Return ONLY the rewritten text, no explanation.\n\n\
         Instruction: {}\n\nText:\n{}",
        instruction, text
    );
    call_ai(&prompt, &state).await
}

/// AI: Summarize the document.
#[tauri::command]
pub async fn ai_summarize(
    content: String,
    max_sentences: Option<u32>,
    state: tauri::State<'_, Mutex<EditorState>>,
) -> Result<AiResult, String> {
    let max = max_sentences.unwrap_or(5);
    let prompt = format!(
        "Summarize the following document in {} sentences or fewer. \
         Use the same language as the input.\n\n{}",
        max, content
    );
    call_ai(&prompt, &state).await
}

/// AI: Translate the text to a target language.
#[tauri::command]
pub async fn ai_translate(
    text: String,
    target_lang: String,
    state: tauri::State<'_, Mutex<EditorState>>,
) -> Result<AiResult, String> {
    let prompt = format!(
        "Translate the following text to {}. \
         Return ONLY the translated text, no explanation.\n\n{}",
        target_lang, text
    );
    call_ai(&prompt, &state).await
}

// ─── AI client (async) ──────────────────────────────────────────────

async fn call_ai(prompt: &str, state: &Mutex<EditorState>) -> Result<AiResult, String> {
    let (endpoint, key, model) = {
        let s = state.lock().map_err(|e| e.to_string())?;
        (
            s.settings.ai_endpoint.clone(),
            s.settings.ai_key.clone(),
            s.settings.ai_model.clone(),
        )
    };

    if endpoint.is_empty() || key.is_empty() {
        return Err("AI not configured. Set your API endpoint and key in Settings.".into());
    }

    let url = format!("{}/chat/completions", endpoint.trim_end_matches('/'));

    let body = ChatRequest {
        model,
        messages: vec![ChatMessage {
            role: "user".into(),
            content: prompt.to_string(),
        }],
        stream: false,
        max_tokens: 2048,
    };

    let resp = client()
        .post(&url)
        .header("Authorization", format!("Bearer {}", key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("AI request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        // Don't log the response body — might contain the API key in error messages
        return Err(format!("AI returned HTTP {}", status));
    }

    let chat_resp: ChatResponse = resp
        .json()
        .await
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
