use crate::commands::editor::EditorState;
use futures::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock, atomic::{AtomicBool, Ordering}};
use tauri::Emitter;

// ─── Streaming cancellation flag ──────────────────────────────────
static STREAM_CANCEL: AtomicBool = AtomicBool::new(false);

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
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

// ─── Streaming types ─────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct StreamChunk {
    choices: Vec<StreamChoice>,
}

#[derive(Debug, Deserialize)]
struct StreamChoice {
    delta: Option<StreamDelta>,
}

#[derive(Debug, Deserialize)]
struct StreamDelta {
    content: Option<String>,
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

// ─── Streaming AI command ─────────────────────────────────────────

/// AI: Explain with SSE streaming — emits 'ai-chunk' and 'ai-done' events.
#[tauri::command]
pub async fn ai_explain_stream(
    text: String,
    context: Option<String>,
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<EditorState>>,
) -> Result<(), String> {
    let prompt = format!(
        "Explain the following Markdown content clearly and concisely. \
         Use the same language as the input.\n\n{}",
        if let Some(ctx) = context {
            format!("Document context:\n{}\n\nSelected text to explain:\n{}", ctx, text)
        } else {
            format!("Text to explain:\n{}", text)
        }
    );
    call_ai_stream(&prompt, &app, &state).await
}

/// AI: Summarize with SSE streaming.
#[tauri::command]
pub async fn ai_summarize_stream(
    content: String,
    max_sentences: Option<u32>,
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<EditorState>>,
) -> Result<(), String> {
    let max = max_sentences.unwrap_or(5);
    let prompt = format!(
        "Summarize the following document in {} sentences or fewer. \
         Use the same language as the input.\n\n{}",
        max, content
    );
    call_ai_stream(&prompt, &app, &state).await
}

/// AI: Translate with SSE streaming.
#[tauri::command]
pub async fn ai_translate_stream(
    text: String,
    target_lang: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<EditorState>>,
) -> Result<(), String> {
    let prompt = format!(
        "Translate the following text to {}. \
         Return ONLY the translated text, no explanation.\n\n{}",
        target_lang, text
    );
    call_ai_stream(&prompt, &app, &state).await
}

/// AI: Rewrite with SSE streaming.
#[tauri::command]
pub async fn ai_rewrite_stream(
    text: String,
    instruction: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<EditorState>>,
) -> Result<(), String> {
    let prompt = format!(
        "Rewrite the following text according to the instruction. \
         Return ONLY the rewritten text, no explanation.\n\n\
         Instruction: {}\n\nText:\n{}",
        instruction, text
    );
    call_ai_stream(&prompt, &app, &state).await
}

/// AI: Continue writing from the cursor position (streaming).
#[tauri::command]
pub async fn ai_continue_stream(
    text_before: String,
    text_after: Option<String>,
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<EditorState>>,
) -> Result<(), String> {
    let prompt = if let Some(after) = text_after {
        if !after.trim().is_empty() {
            format!(
                "Continue the following text naturally from where it left off. \
                 Write ONLY the continuation — do NOT repeat or rewrite the existing text. \
                 Match the style, tone, and language of the existing content.\
                 \n\nText so far:\n{}\n\nText that follows (maintain coherence):\n{}",
                text_before, after
            )
        } else {
            format!(
                "Continue the following text naturally from where it left off. \
                 Write ONLY the continuation — do NOT repeat or rewrite the existing text. \
                 Match the style, tone, and language.\
                 \n\nText so far:\n{}",
                text_before
            )
        }
    } else {
        format!(
            "Continue the following text naturally from where it left off. \
             Write ONLY the continuation — do NOT repeat or rewrite the existing text. \
             Match the style, tone, and language.\
             \n\nText so far:\n{}",
            text_before
        )
    };
    call_ai_stream(&prompt, &app, &state).await
}

/// Cancel the currently running AI stream.
/// AI: Multi-turn chat with streaming.
/// messages: array of {role: "user"|"assistant"|"system", content: "..."}
#[tauri::command]
pub async fn ai_chat_stream(
    messages: Vec<ChatMessage>,
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<EditorState>>,
) -> Result<(), String> {
    if messages.is_empty() {
        return Err("No messages provided".into());
    }
    call_ai_chat_stream(&messages, &app, &state).await
}

/// AI: Multi-turn chat (non-streaming, returns full response).
#[tauri::command]
pub async fn ai_chat(
    messages: Vec<ChatMessage>,
    state: tauri::State<'_, Mutex<EditorState>>,
) -> Result<AiResult, String> {
    if messages.is_empty() {
        return Err("No messages provided".into());
    }
    call_ai_chat(&messages, &state).await
}

#[tauri::command]
pub fn ai_stream_cancel() {
    STREAM_CANCEL.store(true, Ordering::SeqCst);
}

async fn call_ai_stream(
    prompt: &str,
    app: &tauri::AppHandle,
    state: &Mutex<EditorState>,
) -> Result<(), String> {
    // Reset cancellation flag
    STREAM_CANCEL.store(false, Ordering::SeqCst);

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

    let body = serde_json::json!({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": true,
        "max_tokens": 2048
    });

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
        return Err(format!("AI returned HTTP {}", status));
    }

    let mut stream = resp.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk_result) = stream.next().await {
        // Check cancellation
        if STREAM_CANCEL.load(Ordering::SeqCst) {
            let _ = app.emit("ai-done", "cancelled");
            return Ok(());
        }

        let chunk = chunk_result.map_err(|e| format!("Stream error: {}", e))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        // Process complete SSE lines
        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim().to_string();
            buffer = buffer[line_end + 1..].to_string();

            if line.is_empty() {
                continue;
            }

            if let Some(data) = line.strip_prefix("data: ") {
                if data == "[DONE]" {
                    let _ = app.emit("ai-done", "done");
                    return Ok(());
                }

                if let Ok(chunk) = serde_json::from_str::<StreamChunk>(data) {
                    if let Some(choice) = chunk.choices.first() {
                        if let Some(delta) = &choice.delta {
                            if let Some(content) = &delta.content {
                                let _ = app.emit("ai-chunk", content.clone());
                            }
                        }
                    }
                }
            }
        }
    }

    // Stream ended without [DONE]
    let _ = app.emit("ai-done", "done");
    Ok(())
}

async fn call_ai_chat(
    messages: &[ChatMessage],
    state: &Mutex<EditorState>,
) -> Result<AiResult, String> {
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
        messages: messages.to_vec(),
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

async fn call_ai_chat_stream(
    messages: &[ChatMessage],
    app: &tauri::AppHandle,
    state: &Mutex<EditorState>,
) -> Result<(), String> {
    STREAM_CANCEL.store(false, Ordering::SeqCst);

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

    let body = serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": true,
        "max_tokens": 2048
    });

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
        return Err(format!("AI returned HTTP {}", status));
    }

    let mut stream = resp.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk_result) = stream.next().await {
        if STREAM_CANCEL.load(Ordering::SeqCst) {
            let _ = app.emit("ai-done", "cancelled");
            return Ok(());
        }

        let chunk = chunk_result.map_err(|e| format!("Stream error: {}", e))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim().to_string();
            buffer = buffer[line_end + 1..].to_string();

            if line.is_empty() {
                continue;
            }

            if let Some(data) = line.strip_prefix("data: ") {
                if data == "[DONE]" {
                    let _ = app.emit("ai-done", "done");
                    return Ok(());
                }

                if let Ok(chunk) = serde_json::from_str::<StreamChunk>(data) {
                    if let Some(choice) = chunk.choices.first() {
                        if let Some(delta) = &choice.delta {
                            if let Some(content) = &delta.content {
                                let _ = app.emit("ai-chunk", content.clone());
                            }
                        }
                    }
                }
            }
        }
    }

    let _ = app.emit("ai-done", "done");
    Ok(())
}
