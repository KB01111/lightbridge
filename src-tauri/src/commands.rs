use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

use crate::capture::{capture_window_image, persist_capture, resolve_foreground_window};
use crate::models::*;
use crate::ocr;
use crate::openai;
use crate::secrets;
use crate::state::AppState;

fn map_err(e: impl std::fmt::Display) -> String {
    e.to_string()
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
    secrets::set_openai_api_key(&key).map_err(map_err)
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
pub fn list_captures(
    state: State<'_, AppState>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<CaptureRecord>, String> {
    state
        .db
        .list_captures(limit.unwrap_or(50), offset.unwrap_or(0))
        .map_err(map_err)
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
        .search_memory(&query, limit.unwrap_or(20))
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
pub fn delete_all_data(state: State<'_, AppState>) -> Result<(), String> {
    state.db.delete_all_data().map_err(map_err)
}

/// Capture the previously focused window (or current foreground if still external).
#[tauri::command]
pub async fn capture_foreground(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<CaptureRecord, String> {
    let exclude = app
        .get_webview_window("main")
        .and_then(|w| w.hwnd().ok())
        .map(|h| h.0 as u64);

    let pending = state.pending_target_hwnd.lock().take();

    let info = tauri::async_runtime::spawn_blocking(move || {
        if let Some(hwnd) = pending {
            // Re-resolve metadata for the stored hwnd via foreground path first.
            // If foreground already moved, still try resolve_foreground and compare.
            let fg = resolve_foreground_window(exclude)?;
            if fg.hwnd == hwnd || exclude.map(|e| fg.hwnd != e).unwrap_or(true) {
                // Prefer true foreground if it is not LightBridge.
                if crate::capture::is_self_window(&fg) {
                    anyhow::bail!("cannot capture LightBridge");
                }
                Ok(fg)
            } else {
                Ok(fg)
            }
        } else {
            resolve_foreground_window(exclude)
        }
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(map_err)?;

    let captures_dir = state.db.captures_dir();
    let rec = tauri::async_runtime::spawn_blocking(move || {
        let image = capture_window_image(&info)?;
        persist_capture(&captures_dir, info, image)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(map_err)?;

    state.db.insert_capture(&rec).map_err(map_err)?;

    // OCR in background
    let db = state.db.clone();
    let app2 = app.clone();
    let capture_id = rec.id.clone();
    let image_path = PathBuf::from(&rec.image_path);
    tauri::async_runtime::spawn(async move {
        let ocr_result =
            tauri::async_runtime::spawn_blocking(move || ocr::ocr_image_path(&image_path)).await;
        match ocr_result {
            Ok(Ok(text)) => {
                let _ = db.update_capture_ocr(&capture_id, Some(&text), "done");
                if let Ok(Some(full)) = db.get_capture(&capture_id) {
                    let _ = app2.emit("context://ocr-updated", full);
                }
            }
            Ok(Err(e)) => {
                let _ = e;
                let _ = db.update_capture_ocr(&capture_id, None, "failed");
                if let Ok(Some(full)) = db.get_capture(&capture_id) {
                    let _ = app2.emit("context://ocr-updated", full);
                }
            }
            Err(e) => {
                let _ = e;
                let _ = db.update_capture_ocr(&capture_id, None, "failed");
            }
        }
    });

    let _ = app.emit("context://captured", &rec);
    Ok(rec)
}

#[tauri::command]
pub async fn start_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    args: StartChatArgs,
) -> Result<String, String> {
    openai::validate_model(&args.model).map_err(map_err)?;
    let api_key = secrets::get_openai_api_key()
        .map_err(map_err)?
        .ok_or_else(|| "OpenAI API key not configured. Open Settings to add it.".to_string())?;

    let stream_id = Uuid::new_v4().to_string();
    let (tx, mut rx) = tokio::sync::watch::channel(true);
    state.streams.lock().insert(stream_id.clone(), tx);

    state
        .db
        .insert_message(&args.conversation_id, "user", &args.user_message)
        .map_err(map_err)?;

    let history = state
        .db
        .list_messages(&args.conversation_id)
        .map_err(map_err)?;
    // Drop the just-inserted user message from history for build (we'll add via args)
    let hist: Vec<(String, String)> = history
        .iter()
        .filter(|m| m.role != "user" || m.content != args.user_message)
        .map(|m| (m.role.clone(), m.content.clone()))
        .collect();
    // Better: all but last
    let hist: Vec<(String, String)> = if !history.is_empty() {
        history[..history.len().saturating_sub(1)]
            .iter()
            .map(|m| (m.role.clone(), m.content.clone()))
            .collect()
    } else {
        hist
    };

    let messages = openai::build_messages(&hist, &args.context_blocks, &args.user_message);
    let db = state.db.clone();
    let conversation_id = args.conversation_id.clone();
    let model = args.model.clone();
    let stream_id_task = stream_id.clone();
    let app_task = app.clone();

    tauri::async_runtime::spawn(async move {
        let result = tokio::select! {
            biased;
            _ = async {
                loop {
                    if !*rx.borrow() {
                        break;
                    }
                    if rx.changed().await.is_err() {
                        break;
                    }
                }
            } => {
                Err(anyhow::anyhow!("cancelled"))
            }
            res = openai::stream_chat_completion(
                app_task.clone(),
                &api_key,
                &model,
                messages,
                &stream_id_task,
            ) => res
        };

        match result {
            Ok(full) => {
                if let Ok(msg) = db.insert_message(&conversation_id, "assistant", &full) {
                    let _ = app_task.emit(
                        "chat://done",
                        ChatDone {
                            stream_id: stream_id_task.clone(),
                            message_id: msg.id,
                        },
                    );
                }
            }
            Err(e) => {
                let _ = app_task.emit(
                    "chat://error",
                    ChatError {
                        stream_id: stream_id_task.clone(),
                        message: e.to_string(),
                    },
                );
            }
        }
    });

    Ok(stream_id)
}

#[tauri::command]
pub fn cancel_chat(state: State<'_, AppState>, stream_id: String) -> Result<(), String> {
    if let Some(tx) = state.streams.lock().remove(&stream_id) {
        let _ = tx.send(false);
    }
    Ok(())
}

#[tauri::command]
pub fn clear_api_key() -> Result<(), String> {
    secrets::set_openai_api_key("").map_err(map_err)
}

#[tauri::command]
pub fn remember_target_hwnd(state: State<'_, AppState>) -> Result<u64, String> {
    let info = resolve_foreground_window(None).map_err(map_err)?;
    if crate::capture::is_self_window(&info) {
        return Err("foreground is LightBridge".into());
    }
    *state.pending_target_hwnd.lock() = Some(info.hwnd);
    Ok(info.hwnd)
}

#[tauri::command]
pub async fn show_overlay(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    // Capture target hwnd BEFORE focusing LightBridge
    let _ = remember_target_hwnd(state);
    if let Some(win) = app.get_webview_window("main") {
        win.show().map_err(map_err)?;
        win.set_focus().map_err(map_err)?;
    }
    let _ = app.emit("overlay://shown", true);
    Ok(())
}

#[tauri::command]
pub fn hide_overlay(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        win.hide().map_err(map_err)?;
    }
    Ok(())
}
