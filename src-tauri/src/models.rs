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
    pub provider: Option<String>,
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
    pub route_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelRoute {
    pub id: String,
    pub label: String,
    pub model: String,
    pub fallback_models: Vec<String>,
    pub reasoning_effort: String,
}

pub fn default_model_routes() -> Vec<ModelRoute> {
    vec![
        ModelRoute {
            id: "best".into(),
            label: "Best".into(),
            model: "openai/gpt-5.6-sol".into(),
            fallback_models: vec![],
            reasoning_effort: "high".into(),
        },
        ModelRoute {
            id: "balanced".into(),
            label: "Balanced".into(),
            model: "openai/gpt-5.6-terra".into(),
            fallback_models: vec![],
            reasoning_effort: "medium".into(),
        },
        ModelRoute {
            id: "fast".into(),
            label: "Fast".into(),
            model: "openai/gpt-5.6-luna".into(),
            fallback_models: vec![],
            reasoning_effort: "low".into(),
        },
    ]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayPreferences {
    pub opacity: u8,
    pub always_on_top: bool,
    pub orb_enabled: bool,
    pub orb_edge: String,
    pub orb_offset: i32,
    pub paused: bool,
}

impl Default for OverlayPreferences {
    fn default() -> Self {
        Self {
            opacity: 88,
            always_on_top: true,
            orb_enabled: true,
            orb_edge: "right".into(),
            orb_offset: 160,
            paused: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearancePreferences {
    pub mode: String,
    pub reduced_motion: bool,
}

impl Default for AppearancePreferences {
    fn default() -> Self {
        Self {
            mode: "dark".into(),
            reduced_motion: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub shortcut: String,
    pub ai_profile: String,
    pub capture_retention_days: u32,
    pub privacy_acknowledged: bool,
    pub last_active_conversation: Option<String>,
    pub gateway_mode: String,
    pub external_gateway_url: Option<String>,
    pub external_gateway_auth: String,
    pub configured_provider_ids: Vec<String>,
    pub model_routes: Vec<ModelRoute>,
    pub overlay: OverlayPreferences,
    pub appearance: AppearancePreferences,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            shortcut: "Ctrl+Shift+Space".into(),
            ai_profile: "best".into(),
            capture_retention_days: 30,
            privacy_acknowledged: false,
            last_active_conversation: None,
            gateway_mode: "managed".into(),
            external_gateway_url: None,
            external_gateway_auth: "none".into(),
            configured_provider_ids: vec![],
            model_routes: default_model_routes(),
            overlay: OverlayPreferences::default(),
            appearance: AppearancePreferences::default(),
        }
    }
}

impl AppSettings {
    pub fn route(&self, id: &str) -> Option<ModelRoute> {
        self.model_routes
            .iter()
            .find(|route| route.id == id)
            .cloned()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDescriptor {
    pub id: String,
    pub label: String,
    pub description: String,
    pub credential_label: String,
    pub credential_placeholder: String,
    pub is_local: bool,
    pub is_curated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConnection {
    pub provider: ProviderDescriptor,
    pub is_configured: bool,
    pub base_url: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDescriptor {
    pub id: String,
    pub provider: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayStatus {
    pub mode: String,
    pub phase: String,
    pub message: String,
    pub version: Option<String>,
    pub endpoint: Option<String>,
    pub installed: bool,
    pub healthy: bool,
    pub configured_providers: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayInstallProgress {
    pub phase: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub percent: u8,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrbState {
    pub phase: String,
    pub label: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStatus {
    pub phase: String,
    pub message: String,
}

pub fn curated_providers() -> Vec<ProviderDescriptor> {
    [
        (
            "openai",
            "OpenAI",
            "GPT and reasoning models",
            "API key",
            "sk-…",
            false,
        ),
        (
            "anthropic",
            "Anthropic",
            "Claude models",
            "API key",
            "sk-ant-…",
            false,
        ),
        (
            "gemini",
            "Google Gemini",
            "Gemini multimodal models",
            "API key",
            "AIza…",
            false,
        ),
        (
            "openrouter",
            "OpenRouter",
            "One key for many hosted models",
            "API key",
            "sk-or-…",
            false,
        ),
        (
            "groq",
            "Groq",
            "Low-latency hosted inference",
            "API key",
            "gsk_…",
            false,
        ),
        (
            "ollama",
            "Ollama",
            "Models running on this device",
            "Local endpoint",
            "http://127.0.0.1:11434",
            true,
        ),
    ]
    .into_iter()
    .map(
        |(id, label, description, credential_label, placeholder, is_local)| ProviderDescriptor {
            id: id.into(),
            label: label.into(),
            description: description.into(),
            credential_label: credential_label.into(),
            credential_placeholder: placeholder.into(),
            is_local,
            is_curated: true,
        },
    )
    .collect()
}
