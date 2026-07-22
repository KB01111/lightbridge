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
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryHit {
    pub kind: String,
    pub ref_id: String,
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
pub struct ChatDone {
    pub stream_id: String,
    pub message_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatError {
    pub stream_id: String,
    pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartChatArgs {
    pub conversation_id: String,
    pub user_message: String,
    pub context_blocks: Vec<String>,
    pub model: String,
}
