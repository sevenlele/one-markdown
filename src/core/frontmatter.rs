use serde::{Deserialize, Serialize};

/// Frontmatter metadata embedded in the .md file header.
/// Stored between --- delimiters at the top of the file.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Frontmatter {
    pub title: Option<String>,
    pub date: Option<String>,
    pub updated: Option<String>,
    pub tags: Option<Vec<String>>,
    pub description: Option<String>,
    pub author: Option<String>,
    pub draft: Option<bool>,
    pub cover: Option<String>,
}

/// Parsed result: frontmatter + remaining body content.
#[derive(Debug, Clone)]
pub struct ParsedDocument {
    pub frontmatter: Frontmatter,
    pub body: String,
    pub has_frontmatter: bool,
}

/// Parse a Markdown file that may or may not have YAML frontmatter.
///
/// Frontmatter format:
/// ```markdown
/// ---
/// title: My Post
/// tags: [rust, markdown]
/// ---
///
/// # Content starts here
/// ```
pub fn parse(content: &str) -> ParsedDocument {
    let trimmed = content.trim_start();

    if !trimmed.starts_with("---") {
        return ParsedDocument {
            frontmatter: Frontmatter::default(),
            body: content.to_string(),
            has_frontmatter: false,
        };
    }

    // Find the closing ---
    let after_first = &trimmed[3..];
    if let Some(end_idx) = after_first.find("\n---") {
        let yaml_str = &after_first[..end_idx];
        let body_start = end_idx + 4; // skip \n---

        let frontmatter: Frontmatter = serde_yaml::from_str(yaml_str).unwrap_or_default();
        let body = after_first[body_start..].trim_start_matches('\n').to_string();

        ParsedDocument {
            frontmatter,
            body,
            has_frontmatter: true,
        }
    } else {
        // No closing ---, treat as regular content
        ParsedDocument {
            frontmatter: Frontmatter::default(),
            body: content.to_string(),
            has_frontmatter: false,
        }
    }
}

/// Serialize a document back to the single-file format.
pub fn serialize(frontmatter: &Frontmatter, body: &str) -> String {
    // Only write frontmatter if there's meaningful content
    let has_data = frontmatter.title.is_some()
        || frontmatter.tags.is_some()
        || frontmatter.description.is_some()
        || frontmatter.author.is_some()
        || frontmatter.draft.is_some();

    if !has_data {
        return body.to_string();
    }

    let yaml = serde_yaml::to_string(frontmatter).unwrap_or_default();
    format!("---\n{}\n---\n\n{}", yaml.trim_end(), body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_no_frontmatter() {
        let doc = parse("# Hello\n\nWorld");
        assert!(!doc.has_frontmatter);
        assert_eq!(doc.body, "# Hello\n\nWorld");
    }

    #[test]
    fn test_parse_with_frontmatter() {
        let input = "---\ntitle: Test\ntags:\n  - rust\n---\n\n# Hello";
        let doc = parse(input);
        assert!(doc.has_frontmatter);
        assert_eq!(doc.frontmatter.title, Some("Test".to_string()));
        assert_eq!(doc.body, "# Hello");
    }

    #[test]
    fn test_roundtrip() {
        let mut fm = Frontmatter::default();
        fm.title = Some("My Post".to_string());
        fm.tags = Some(vec!["rust".into(), "md".into()]);
        let body = "# Content";
        let serialized = serialize(&fm, body);
        let parsed = parse(&serialized);
        assert_eq!(parsed.frontmatter.title, Some("My Post".to_string()));
        assert_eq!(parsed.body, "# Content");
    }
}
