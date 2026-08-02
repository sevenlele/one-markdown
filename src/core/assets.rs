use anyhow::{Context, Result};
use base64::Engine;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

/// Strategy for handling pasted images.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ImageStrategy {
    /// Embed as base64 data URI directly in the .md file.
    Inline,
    /// Save to a .assets/ directory next to the .md file.
    AssetDir,
}

/// Result of saving a pasted image.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedImage {
    /// The Markdown image reference to insert.
    pub markdown_ref: String,
    /// Absolute path where the image was saved (for AssetDir strategy).
    pub saved_path: Option<String>,
    /// File size in bytes.
    pub size_bytes: u64,
}

/// Save a pasted image (raw bytes) according to the chosen strategy.
///
/// - `Inline`: returns a `data:image/png;base64,...` reference
/// - `AssetDir`: saves to `<doc_dir>/.assets/<hash>.png` and returns relative path
pub fn save_image(
    image_data: &[u8],
    mime_type: &str,
    doc_path: Option<&str>,
    strategy: &ImageStrategy,
) -> Result<SavedImage> {
    let ext = mime_to_ext(mime_type);
    let hash = short_hash(image_data);
    let filename = format!("{}.{}", hash, ext);

    match strategy {
        ImageStrategy::Inline => {
            let b64 = base64::engine::general_purpose::STANDARD.encode(image_data);
            let data_uri = format!("data:{};base64,{}", mime_type, b64);
            Ok(SavedImage {
                markdown_ref: format!("![image]({})", data_uri),
                saved_path: None,
                size_bytes: image_data.len() as u64,
            })
        }
        ImageStrategy::AssetDir => {
            let doc_path = doc_path.context("Need file path for asset directory strategy")?;
            let doc_dir = Path::new(doc_path)
                .parent()
                .context("Cannot determine document directory")?;
            let assets_dir = doc_dir.join(".assets");
            fs::create_dir_all(&assets_dir)?;

            let file_path = assets_dir.join(&filename);
            fs::write(&file_path, image_data)?;

            // Use relative path from doc to asset
            let relative = format!(".assets/{}", filename);
            Ok(SavedImage {
                markdown_ref: format!("![image]({})", relative),
                saved_path: Some(file_path.to_string_lossy().to_string()),
                size_bytes: image_data.len() as u64,
            })
        }
    }
}

/// Resolve an image path (which may be relative to the doc) to an absolute path.
pub fn resolve_image_path(doc_path: &str, image_ref: &str) -> Option<PathBuf> {
    if image_ref.starts_with("data:") {
        return None; // base64, no file
    }
    if image_ref.starts_with("http://") || image_ref.starts_with("https://") {
        return None; // remote URL
    }

    let doc_dir = Path::new(doc_path).parent()?;
    let resolved = doc_dir.join(image_ref);
    if resolved.exists() {
        Some(resolved)
    } else {
        None
    }
}

fn mime_to_ext(mime: &str) -> &str {
    match mime {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        _ => "png",
    }
}

fn short_hash(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    let result = hasher.finalize();
    // First 12 hex chars is enough for uniqueness
    hex_encode(&result[..6])
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}
