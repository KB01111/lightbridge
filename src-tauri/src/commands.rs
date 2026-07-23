use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::Arc;

use anyhow::{anyhow, bail, Context, Result};
use parking_lot::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
use uuid::Uuid;

use crate::capture::{
    capture_window_image, make_api_image_base64, persist_capture, resolve_foreground_window,
    resolve_window,
};
use crate::models::*;
use crate::ocr;
use crate::openai::{self, ResolvedContext};
use crate::secrets;
use crate::state::AppState;

fn map_err(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[tauri::command]
pub fn get_product_info() -> serde_json::Value {
    serde_json::json!({
        "name": "LightBridge",
        "version": env!("CARGO_PKG_VERSION"),
        "identifier": "com.lightbridge.desktop",
    })
}

#[tauri::command]
pub fn has_api_key() -> bool {
    secrets::has_openai_api_key()
}

#[tauri::command]
pub fn set_api_key(key: String) -> Result<(), String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err("Enter a non-empty OpenAI API key.".into());
    }
    secrets::set_openai_api_key(trimmed).map_err(map_err)
}

#[tauri::command]
pub fn clear_api_key() -> Result<(), String> {
    secrets::set_openai_api_key("").map_err(map_err)
}

#[tauri::command]
pub fn estimate_tokens(text: String) -> u32 {
    openai::estimate_tokens(&text)
}

#[tauri::command]
pub fn list_conversations(state: State<'_, AppState>) -> Result<Vec<ConversationRecord>, String> {
    state.db.list_conversations().map_err(map_err)
}

#[tauri::command]
pub fn create_conversation(
    state: State<'_, AppState>,
    title: Option<String>,
) -> Result<ConversationRecord, String> {
    state
        .db
        .create_conversation(title.as_deref().unwrap_or("New chat"))
        .map_err(map_err)
}

#[tauri::command]
pub fn delete_conversation(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.db.delete_conversation(&id).map_err(map_err)
}

#[tauri::command]
pub fn list_messages(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<Vec<ChatMessageRecord>, String> {
    state.db.list_messages(&conversation_id).map_err(map_err)
}

#[tauri::command]
pub fn get_conversation_context(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<Vec<ContextSelection>, String> {
    state
        .db
        .conversation_context(&conversation_id)
        .map_err(map_err)
}

#[tauri::command]
pub fn list_captures(
    state: State<'_, AppState>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<CaptureRecord>, String> {
    state
        .db
        .list_captures(
            limit.unwrap_or(50).clamp(1, 200),
            offset.unwrap_or(0).max(0),
        )
        .map_err(map_err)
}

#[tauri::command]
pub fn get_capture(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<CaptureRecord>, String> {
    state.db.get_capture(&id).map_err(map_err)
}

#[tauri::command]
pub fn get_last_capture(state: State<'_, AppState>) -> Result<Option<CaptureRecord>, String> {
    state.db.last_capture().map_err(map_err)
}

#[tauri::command]
pub fn delete_capture(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.db.delete_capture(&id).map_err(map_err)
}

#[tauri::command]
pub fn search_memory(
    state: State<'_, AppState>,
    query: String,
    limit: Option<i64>,
) -> Result<Vec<MemoryHit>, String> {
    state
        .db
        .search_memory(&query, limit.unwrap_or(20).clamp(1, 100))
        .map_err(map_err)
}

#[tauri::command]
pub fn export_data(state: State<'_, AppState>) -> Result<String, String> {
    let path = state.db.data_dir().join(format!(
        "export-{}.json",
        chrono::Utc::now().format("%Y%m%d-%H%M%S")
    ));
    state.db.export_json(&path).map_err(map_err)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn export_diagnostics(state: State<'_, AppState>) -> Result<String, String> {
    let path = state.db.data_dir().join(format!(
        "diagnostics-{}.json",
        chrono::Utc::now().format("%Y%m%d-%H%M%S")
    ));
    let settings = state.db.settings().map_err(map_err)?;
    let payload = serde_json::json!({
        "product": "LightBridge",
        "version": env!("CARGO_PKG_VERSION"),
        "exportedAt": chrono::Utc::now().to_rfc3339(),
        "platform": "windows-x86_64",
        "counts": state.db.diagnostic_counts().map_err(map_err)?,
        "settings": {
            "aiProfile": settings.ai_profile,
            "captureRetentionDays": settings.capture_retention_days,
            "privacyAcknowledged": settings.privacy_acknowledged,
        },
        "excluded": [
            "api credentials",
            "message text",
            "OCR text",
            "screenshots",
            "window titles",
            "process paths"
        ]
    });
    std::fs::write(&path, serde_json::to_vec_pretty(&payload).map_err(map_err)?)
        .map_err(map_err)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn delete_all_data(state: State<'_, AppState>) -> Result<(), String> {
    state.db.delete_all_data().map_err(map_err)
}

fn emit_capture_status(app: &AppHandle, phase: &str, message: &str) {
    let _ = app.emit(
        "capture://status",
        CaptureStatus {
            phase: phase.into(),
            message: message.into(),
        },
    );
}

async fn perform_capture(app: &AppHandle, state: &AppState) -> Result<CaptureRecord> {
    emit_capture_status(app, "capturing", "Capturing the selected window…");
    let exclude = app
        .get_webview_window("main")
        .and_then(|window| window.hwnd().ok())
        .map(|hwnd| hwnd.0 as u64);
    let pending = state.pending_target_hwnd.lock().take();
    let info = tauri::async_runtime::spawn_blocking(move || match pending {
        Some(hwnd) => resolve_window(hwnd, exclude),
        None => resolve_foreground_window(exclude),
    })
    .await
    .context("capture task stopped")??;

    let captures_dir = state.db.captures_dir();
    let rec = tauri::async_runtime::spawn_blocking(move || {
        let image = capture_window_image(&info)?;
        persist_capture(&captures_dir, info, image)
    })
    .await
    .context("capture encoder stopped")??;
    state.db.insert_capture(&rec)?;
    let retention = state.db.settings()?.capture_retention_days;
    let _ = state.db.prune_captures(retention);

    emit_capture_status(
        app,
        "ocr",
        "Screenshot saved locally. Reading on-screen text…",
    );
    let db = state.db.clone();
    let app_for_ocr = app.clone();
    let capture_id = rec.id.clone();
    let image_path = PathBuf::from(&rec.image_path);
    tauri::async_runtime::spawn(async move {
        let result =
            tauri::async_runtime::spawn_blocking(move || ocr::ocr_image_path(&image_path)).await;
        match result {
            Ok(Ok(text)) => {
                let _ = db.update_capture_ocr(&capture_id, Some(&text), "done");
            }
            Ok(Err(_)) | Err(_) => {
                let _ = db.update_capture_ocr(&capture_id, None, "failed");
            }
        }
        if let Ok(Some(full)) = db.get_capture(&capture_id) {
            let _ = app_for_ocr.emit("context://ocr-updated", full);
        }
        emit_capture_status(&app_for_ocr, "ready", "Capture is ready.");
    });

    let _ = app.emit("context://captured", &rec);
    Ok(rec)
}

#[tauri::command]
pub async fn capture_foreground(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<CaptureRecord, String> {
    match perform_capture(&app, state.inner()).await {
        Ok(capture) => Ok(capture),
        Err(error) => {
            emit_capture_status(&app, "failed", &error.to_string());
            Err(map_err(error))
        }
    }
}

#[tauri::command]
pub async fn recapture(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<CaptureRecord, String> {
    let window = app.get_webview_window("main");
    if let Some(window) = &window {
        window.hide().map_err(map_err)?;
    }
    tokio::time::sleep(std::time::Duration::from_millis(180)).await;
    let target = resolve_foreground_window(None).map_err(map_err)?;
    *state.pending_target_hwnd.lock() = Some(target.hwnd);
    let result = perform_capture(&app, state.inner()).await.map_err(map_err);
    if let Some(window) = window {
        let _ = window.show();
        let _ = window.set_focus();
    }
    result
}

fn resolve_contexts(
    state: &AppState,
    selections: &[ContextSelection],
) -> Result<Vec<ResolvedContext>> {
    if selections.len() > 12 {
        bail!("Select no more than 12 context items.");
    }
    let mut seen = HashSet::new();
    let mut image_count = 0;
    let captures_root = state
        .db
        .captures_dir()
        .canonicalize()
        .context("open captures directory")?;
    let mut resolved = Vec::new();
    for selection in selections {
        if !matches!(selection.kind.as_str(), "window" | "screenshot" | "ocr") {
            bail!("Unsupported context selection.");
        }
        if !seen.insert((selection.capture_id.clone(), selection.kind.clone())) {
            continue;
        }
        let capture = state
            .db
            .get_capture(&selection.capture_id)?
            .ok_or_else(|| anyhow!("A selected capture no longer exists. Remove it and retry."))?;
        match selection.kind.as_str() {
            "window" => resolved.push(ResolvedContext {
                label: format!("Window: {}", capture.window.app_name),
                text: Some(format!(
                    "Application: {}\nWindow title: {}\nSize: {}x{}\nDPI: {}",
                    capture.window.app_name,
                    capture.window.title,
                    capture.window.width,
                    capture.window.height,
                    capture.window.dpi
                )),
                image_data_url: None,
            }),
            "ocr" => {
                let text = capture
                    .ocr_text
                    .filter(|text| !text.trim().is_empty())
                    .ok_or_else(|| anyhow!("OCR is not ready for one selected capture."))?;
                resolved.push(ResolvedContext {
                    label: format!("OCR: {}", capture.window.app_name),
                    text: Some(text),
                    image_data_url: None,
                });
            }
            "screenshot" => {
                image_count += 1;
                if image_count > 4 {
                    bail!("Select no more than four screenshots per message.");
                }
                let image_path = Path::new(&capture.image_path)
                    .canonicalize()
                    .context("open selected screenshot")?;
                if !image_path.starts_with(&captures_root) {
                    bail!("A selected screenshot is outside LightBridge storage.");
                }
                resolved.push(ResolvedContext {
                    label: format!("Screenshot: {}", capture.window.app_name),
                    text: None,
                    image_data_url: Some(make_api_image_base64(&image_path)?),
                });
            }
            _ => unreachable!(),
        }
    }
    Ok(resolved)
}

#[tauri::command]
pub async fn start_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    args: StartChatArgs,
) -> Result<String, String> {
    let user_message = args.user_message.trim();
    if user_message.is_empty() {
        return Err("Enter a message before sending.".into());
    }
    if user_message.chars().count() > 40_000 {
        return Err("The message is too long. Shorten it and retry.".into());
    }
    let profile = resolve_profile(&args.profile)
        .ok_or_else(|| "Unsupported AI quality profile.".to_string())?;
    if !state.db.settings().map_err(map_err)?.privacy_acknowledged {
        return Err("Review and accept the privacy disclosure before sending.".into());
    }
    let api_key = secrets::get_openai_api_key()
        .map_err(map_err)?
        .ok_or_else(|| "OpenAI API key not configured. Open Settings to add it.".to_string())?;
    let contexts = resolve_contexts(state.inner(), &args.context_selections).map_err(map_err)?;
    let history = state
        .db
        .list_messages(&args.conversation_id)
        .map_err(map_err)?;
    state
        .db
        .set_conversation_context(&args.conversation_id, &args.context_selections)
        .map_err(map_err)?;
    state
        .db
        .insert_message(&args.conversation_id, "user", user_message)
        .map_err(map_err)?;
    let draft = state
        .db
        .insert_message_with_state(
            &args.conversation_id,
            "assistant",
            "",
            Some(profile.model),
            "streaming",
            None,
        )
        .map_err(map_err)?;
    let input = openai::build_response_input(&history, &contexts, user_message);

    let stream_id = Uuid::new_v4().to_string();
    let (cancel_tx, mut cancel_rx) = tokio::sync::watch::channel(false);
    state.streams.lock().insert(stream_id.clone(), cancel_tx);

    let db = state.db.clone();
    let streams = state.streams.clone();
    let conversation_id = args.conversation_id;
    let assistant_id = draft.id;
    let stream_id_task = stream_id.clone();
    let app_task = app.clone();
    let partial = Arc::new(Mutex::new(String::new()));
    let checkpoint_partial = partial.clone();
    let checkpoint_db = db.clone();
    let checkpoint_id = assistant_id.clone();

    tauri::async_runtime::spawn(async move {
        enum Outcome {
            Completed(String),
            Cancelled,
            Failed(String),
        }
        let streamed = openai::stream_response(
            app_task.clone(),
            &api_key,
            profile,
            input,
            &stream_id_task,
            move |text| {
                *checkpoint_partial.lock() = text.to_string();
                checkpoint_db.update_message_state(&checkpoint_id, text, "streaming", None)
            },
        );
        let outcome = tokio::select! {
            result = streamed => match result {
                Ok(text) => Outcome::Completed(text),
                Err(error) => Outcome::Failed(error.to_string()),
            },
            _ = async {
                loop {
                    if *cancel_rx.borrow() {
                        break;
                    }
                    if cancel_rx.changed().await.is_err() {
                        break;
                    }
                }
            } => Outcome::Cancelled,
        };

        let (status, error, content) = match outcome {
            Outcome::Completed(content) => ("completed", None, content),
            Outcome::Cancelled => ("cancelled", None, partial.lock().clone()),
            Outcome::Failed(error) => ("failed", Some(error), partial.lock().clone()),
        };
        let persisted = db.update_message_state(&assistant_id, &content, status, error.as_deref());
        streams.lock().remove(&stream_id_task);
        let terminal_error = match persisted {
            Ok(()) => error,
            Err(_) => Some("The response ended, but LightBridge could not persist it.".into()),
        };
        let _ = app_task.emit(
            "chat://finished",
            ChatFinished {
                stream_id: stream_id_task,
                conversation_id,
                message_id: assistant_id,
                status: if terminal_error.is_some() && status == "completed" {
                    "failed".into()
                } else {
                    status.into()
                },
                error: terminal_error,
            },
        );
    });

    Ok(stream_id)
}

#[tauri::command]
pub fn cancel_chat(state: State<'_, AppState>, stream_id: String) -> Result<(), String> {
    if let Some(sender) = state.streams.lock().get(&stream_id) {
        let _ = sender.send(true);
    }
    Ok(())
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    state.db.settings().map_err(map_err)
}

#[tauri::command]
pub fn set_ai_profile(state: State<'_, AppState>, profile: String) -> Result<AppSettings, String> {
    resolve_profile(&profile).ok_or_else(|| "Unsupported AI quality profile.".to_string())?;
    state
        .db
        .set_setting("ai_profile", &profile)
        .map_err(map_err)?;
    state.db.settings().map_err(map_err)
}

#[tauri::command]
pub fn set_capture_retention(state: State<'_, AppState>, days: u32) -> Result<AppSettings, String> {
    if days != 0 && !(1..=3650).contains(&days) {
        return Err("Retention must be 0 (forever) or between 1 and 3650 days.".into());
    }
    state
        .db
        .set_setting("capture_retention_days", &days.to_string())
        .map_err(map_err)?;
    state.db.prune_captures(days).map_err(map_err)?;
    state.db.settings().map_err(map_err)
}

#[tauri::command]
pub fn acknowledge_privacy(state: State<'_, AppState>) -> Result<AppSettings, String> {
    state
        .db
        .set_setting("privacy_acknowledged", "true")
        .map_err(map_err)?;
    state.db.settings().map_err(map_err)
}

#[tauri::command]
pub fn set_last_active_conversation(
    state: State<'_, AppState>,
    conversation_id: Option<String>,
) -> Result<AppSettings, String> {
    if let Some(id) = conversation_id.as_deref() {
        let exists = state
            .db
            .list_conversations()
            .map_err(map_err)?
            .iter()
            .any(|conversation| conversation.id == id);
        if !exists {
            return Err("Conversation no longer exists.".into());
        }
    }
    state
        .db
        .set_setting(
            "last_active_conversation",
            conversation_id.as_deref().unwrap_or(""),
        )
        .map_err(map_err)?;
    state.db.settings().map_err(map_err)
}

#[tauri::command]
pub fn set_shortcut(
    app: AppHandle,
    state: State<'_, AppState>,
    shortcut: String,
) -> Result<AppSettings, String> {
    let requested = shortcut.trim();
    let parsed = Shortcut::from_str(requested)
        .map_err(|_| "Use a shortcut such as Ctrl+Shift+Space.".to_string())?;
    let previous = state.active_shortcut.lock().clone();
    if requested.eq_ignore_ascii_case(&previous) {
        return state.db.settings().map_err(map_err);
    }
    app.global_shortcut()
        .register(parsed)
        .map_err(|_| "That shortcut is already in use. The previous shortcut is still active.")?;
    if let Err(error) = app.global_shortcut().unregister(previous.as_str()) {
        let _ = app.global_shortcut().unregister(parsed);
        return Err(format!(
            "Could not replace the shortcut ({error}). The previous shortcut is still active."
        ));
    }
    if let Err(error) = state.db.set_setting("shortcut", requested) {
        let _ = app.global_shortcut().unregister(parsed);
        let _ = app.global_shortcut().register(previous.as_str());
        return Err(format!(
            "Could not save the shortcut ({error}). The previous shortcut was restored."
        ));
    }
    *state.active_shortcut.lock() = requested.to_string();
    state.db.settings().map_err(map_err)
}

#[tauri::command]
pub fn remember_target_hwnd(state: State<'_, AppState>) -> Result<u64, String> {
    let info = resolve_foreground_window(None).map_err(map_err)?;
    if crate::capture::is_self_window(&info) {
        return Err("Focus another window before capturing.".into());
    }
    *state.pending_target_hwnd.lock() = Some(info.hwnd);
    Ok(info.hwnd)
}

#[tauri::command]
pub async fn show_overlay(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let _ = remember_target_hwnd(state);
    if let Some(window) = app.get_webview_window("main") {
        window.show().map_err(map_err)?;
        window.set_focus().map_err(map_err)?;
    }
    let _ = app.emit("overlay://capture-request", true);
    Ok(())
}

#[tauri::command]
pub fn hide_overlay(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.hide().map_err(map_err)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_registry_is_exact() {
        assert_eq!(resolve_profile("best").unwrap().model, "gpt-5.6-sol");
        assert!(resolve_profile("gpt-5.6-sol").is_none());
        assert!(resolve_profile("BEST").is_none());
    }
}
