use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
    pub hwnd: u64,
    pub process_id: u32,
    pub process_path: String,
    pub app_name: String,
    pub title: String,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub dpi: u32,
    pub monitor: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureRecord {
    pub id: String,
    pub window: WindowInfo,
    pub image_path: String,
    pub preview_base64: String,
    pub content_hash: String,
    pub ocr_text: Option<String>,
    pub ocr_status: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationRecord {
    pub id: String,
    pub title: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageRecord {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub model: Option<String>,
    pub status: String,
    pub error: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryHit {
    pub kind: String,
    pub ref_id: String,
    pub owner_id: String,
    pub source_title: String,
    pub snippet: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatDelta {
    pub stream_id: String,
    pub delta: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatFinished {
    pub stream_id: String,
    pub conversation_id: String,
    pub message_id: String,
    pub status: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextSelection {
    pub capture_id: String,
    pub kind: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartChatArgs {
    pub stream_id: String,
    pub conversation_id: String,
    pub user_message: String,
    pub context_selections: Vec<ContextSelection>,
    pub profile: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub shortcut: String,
    pub ai_profile: String,
    pub capture_retention_days: u32,
    pub privacy_acknowledged: bool,
    pub last_active_conversation: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            shortcut: "Ctrl+Shift+Space".into(),
            ai_profile: "best".into(),
            capture_retention_days: 30,
            privacy_acknowledged: false,
            last_active_conversation: None,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct AiProfile {
    pub model: &'static str,
    pub reasoning_effort: &'static str,
}

pub fn resolve_profile(id: &str) -> Option<AiProfile> {
    match id {
        "best" => Some(AiProfile {
            model: "gpt-5.6-sol",
            reasoning_effort: "high",
        }),
        "balanced" => Some(AiProfile {
            model: "gpt-5.6-terra",
            reasoning_effort: "medium",
        }),
        "fast" => Some(AiProfile {
            model: "gpt-5.6-luna",
            reasoning_effort: "low",
        }),
        _ => None,
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStatus {
    pub phase: String,
    pub message: String,
}
