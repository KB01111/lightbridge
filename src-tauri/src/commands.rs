use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::Arc;

use anyhow::{anyhow, bail, Context, Result};
use parking_lot::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, Position, Size, State, WebviewUrl,
    WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
use uuid::Uuid;

use crate::capture::{
    capture_window_image, make_api_image_base64, persist_capture, resolve_foreground_window,
    resolve_window,
};
use crate::db::Db;
use crate::gateway::{self, ResolvedContext};
use crate::models::*;
use crate::ocr;
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

fn valid_provider_id(provider_id: &str) -> bool {
    !provider_id.is_empty()
        && provider_id.chars().all(|character| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || matches!(character, '-' | '_')
        })
}

fn provider_label(provider_id: &str) -> String {
    provider_id
        .split(['-', '_'])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            chars
                .next()
                .map(|first| first.to_ascii_uppercase().to_string() + chars.as_str())
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[tauri::command]
pub fn list_provider_connections(
    state: State<'_, AppState>,
) -> Result<Vec<ProviderConnection>, String> {
    let settings = state.db.settings().map_err(map_err)?;
    let mut providers = curated_providers();
    for provider_id in &settings.configured_provider_ids {
        if providers.iter().any(|provider| &provider.id == provider_id) {
            continue;
        }
        providers.push(ProviderDescriptor {
            id: provider_id.clone(),
            label: provider_label(provider_id),
            description: "Bifrost provider".into(),
            credential_label: "Provider credential".into(),
            credential_placeholder: "Paste credential".into(),
            is_local: false,
            is_curated: false,
        });
    }
    Ok(providers
        .into_iter()
        .map(|provider| {
            let is_configured = settings.configured_provider_ids.contains(&provider.id)
                && (provider.is_local || secrets::has_provider_credential(&provider.id));
            let base_url = if provider.is_local {
                secrets::get_provider_credential(&provider.id)
                    .ok()
                    .flatten()
            } else {
                None
            };
            ProviderConnection {
                provider,
                is_configured,
                base_url,
                status: if is_configured {
                    "connected".into()
                } else {
                    "notConfigured".into()
                },
            }
        })
        .collect())
}

#[tauri::command]
pub async fn set_provider_credential(
    app: AppHandle,
    state: State<'_, AppState>,
    provider_id: String,
    credential: String,
) -> Result<GatewayStatus, String> {
    let provider_id = provider_id.trim().to_ascii_lowercase();
    if !valid_provider_id(&provider_id) {
        return Err("Use a valid Bifrost provider identifier.".into());
    }
    let is_local = provider_id == "ollama";
    let credential = credential.trim();
    if credential.is_empty() && !is_local {
        return Err("Enter a provider credential.".into());
    }
    if is_local {
        let url = if credential.is_empty() {
            "http://127.0.0.1:11434"
        } else {
            credential
        };
        let parsed = reqwest::Url::parse(url).map_err(|_| "Enter a valid Ollama URL.")?;
        if parsed.scheme() != "http" && parsed.scheme() != "https" {
            return Err("Ollama must use an HTTP or HTTPS URL.".into());
        }
        secrets::set_provider_credential(&provider_id, url).map_err(map_err)?;
    } else {
        secrets::set_provider_credential(&provider_id, credential).map_err(map_err)?;
    }

    let mut settings = state.db.settings().map_err(map_err)?;
    if !settings.configured_provider_ids.contains(&provider_id) {
        settings.configured_provider_ids.push(provider_id);
        settings.configured_provider_ids.sort();
        state
            .db
            .set_setting(
                "configured_provider_ids",
                &serde_json::to_string(&settings.configured_provider_ids).map_err(map_err)?,
            )
            .map_err(map_err)?;
    }
    state.gateway.stop();
    if settings.gateway_mode == "managed" {
        state.gateway.install(&app).await.map_err(map_err)?;
    }
    let settings = state.db.settings().map_err(map_err)?;
    let status = state.gateway.status(&settings).await;
    let _ = app.emit("gateway://status", &status);
    emit_orb_state(&app, state.inner(), Some(&status));
    Ok(status)
}

#[tauri::command]
pub async fn remove_provider(
    app: AppHandle,
    state: State<'_, AppState>,
    provider_id: String,
) -> Result<GatewayStatus, String> {
    let provider_id = provider_id.trim().to_ascii_lowercase();
    if !valid_provider_id(&provider_id) {
        return Err("Invalid provider identifier.".into());
    }
    secrets::set_provider_credential(&provider_id, "").map_err(map_err)?;
    let mut settings = state.db.settings().map_err(map_err)?;
    settings
        .configured_provider_ids
        .retain(|candidate| candidate != &provider_id);
    state
        .db
        .set_setting(
            "configured_provider_ids",
            &serde_json::to_string(&settings.configured_provider_ids).map_err(map_err)?,
        )
        .map_err(map_err)?;
    state.gateway.stop();
    let settings = state.db.settings().map_err(map_err)?;
    let status = state.gateway.status(&settings).await;
    let _ = app.emit("gateway://status", &status);
    emit_orb_state(&app, state.inner(), Some(&status));
    Ok(status)
}

#[tauri::command]
pub async fn get_gateway_status(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<GatewayStatus, String> {
    let settings = state.db.settings().map_err(map_err)?;
    let status = state.gateway.status(&settings).await;
    let _ = app.emit("gateway://status", &status);
    emit_orb_state(&app, state.inner(), Some(&status));
    Ok(status)
}

#[tauri::command]
pub async fn get_orb_state(state: State<'_, AppState>) -> Result<OrbState, String> {
    if *state.paused.lock()
        || !state.streams.lock().is_empty()
        || state.active_capture_operation.lock().is_some()
    {
        return Ok(orb_state_for(state.inner(), None));
    }
    let settings = state.db.settings().map_err(map_err)?;
    let status = state.gateway.status(&settings).await;
    Ok(orb_state_for(state.inner(), Some(&status)))
}

#[tauri::command]
pub async fn install_gateway(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<GatewayStatus, String> {
    state.gateway.install(&app).await.map_err(map_err)?;
    let settings = state.db.settings().map_err(map_err)?;
    let status = state.gateway.status(&settings).await;
    let _ = app.emit("gateway://status", &status);
    emit_orb_state(&app, state.inner(), Some(&status));
    Ok(status)
}

#[tauri::command]
pub async fn list_models(state: State<'_, AppState>) -> Result<Vec<ModelDescriptor>, String> {
    let settings = state.db.settings().map_err(map_err)?;
    state.gateway.list_models(&settings).await.map_err(map_err)
}

#[tauri::command]
pub fn has_api_key() -> bool {
    secrets::has_provider_credential("openai")
}

#[tauri::command]
pub fn set_api_key(key: String) -> Result<(), String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err("Enter a non-empty OpenAI API key.".into());
    }
    secrets::set_provider_credential("openai", trimmed).map_err(map_err)
}

#[tauri::command]
pub fn clear_api_key() -> Result<(), String> {
    secrets::set_provider_credential("openai", "").map_err(map_err)
}

#[tauri::command]
pub fn estimate_tokens(text: String) -> u32 {
    gateway::estimate_tokens(&text)
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

fn emit_orb_phase(app: &AppHandle, phase: &str, label: &str, detail: &str) {
    let _ = app.emit(
        "orb://state",
        OrbState {
            phase: phase.into(),
            label: label.into(),
            detail: detail.into(),
        },
    );
}

fn orb_state_for(state: &AppState, gateway_status: Option<&GatewayStatus>) -> OrbState {
    if *state.paused.lock() {
        return OrbState {
            phase: "paused".into(),
            label: "Paused".into(),
            detail: "Capture and AI requests are paused.".into(),
        };
    }
    if !state.streams.lock().is_empty() {
        return OrbState {
            phase: "generating".into(),
            label: "Generating".into(),
            detail: "Bifrost is streaming a response.".into(),
        };
    }
    if state.active_capture_operation.lock().is_some() {
        return OrbState {
            phase: "capturing".into(),
            label: "Capturing".into(),
            detail: "LightBridge is reading the selected window.".into(),
        };
    }
    match gateway_status.map(|status| status.phase.as_str()) {
        Some("ready") => OrbState {
            phase: "ready".into(),
            label: "Ready".into(),
            detail: "LightBridge and Bifrost are active.".into(),
        },
        Some("offline") | Some("notInstalled") => OrbState {
            phase: "offline".into(),
            label: "Gateway offline".into(),
            detail: gateway_status
                .map(|status| status.message.clone())
                .unwrap_or_default(),
        },
        _ => OrbState {
            phase: "setupRequired".into(),
            label: "Setup required".into(),
            detail: "Connect a provider in Settings to activate AI.".into(),
        },
    }
}

fn emit_orb_state(app: &AppHandle, state: &AppState, gateway_status: Option<&GatewayStatus>) {
    let _ = app.emit("orb://state", orb_state_for(state, gateway_status));
}

async fn perform_capture(app: &AppHandle, state: &AppState) -> Result<CaptureRecord> {
    if *state.paused.lock() {
        bail!("LightBridge is paused. Resume it from the orb or tray menu.");
    }
    let operation_id = Uuid::new_v4().to_string();
    *state.active_capture_operation.lock() = Some(operation_id.clone());
    emit_capture_status(app, "capturing", "Capturing the selected window…");
    emit_orb_phase(
        app,
        "capturing",
        "Capturing",
        "Reading the selected window.",
    );
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
    let active_capture_operation = state.active_capture_operation.clone();
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
        if active_capture_operation.lock().as_deref() == Some(&operation_id) {
            *active_capture_operation.lock() = None;
            emit_capture_status(&app_for_ocr, "ready", "Capture is ready.");
            emit_orb_phase(&app_for_ocr, "ready", "Ready", "Capture is ready to use.");
        }
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
            *state.active_capture_operation.lock() = None;
            emit_capture_status(&app, "failed", &error.to_string());
            emit_orb_phase(
                &app,
                "error",
                "Capture failed",
                "Open the overlay for recovery options.",
            );
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

fn resolve_contexts(db: &Db, selections: &[ContextSelection]) -> Result<Vec<ResolvedContext>> {
    if selections.len() > 12 {
        bail!("Select no more than 12 context items.");
    }
    let mut seen = HashSet::new();
    let mut image_count = 0;
    let captures_root = db
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
        let capture = db
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
    Uuid::parse_str(&args.stream_id).map_err(|_| "Invalid chat stream identifier.".to_string())?;
    let settings = state.db.settings().map_err(map_err)?;
    let route = settings
        .route(&args.route_id)
        .ok_or_else(|| "That model route no longer exists. Choose another route.".to_string())?;
    if !settings.privacy_acknowledged {
        return Err("Review and accept the privacy disclosure before sending.".into());
    }
    if *state.paused.lock() {
        return Err("LightBridge is paused. Resume it from the orb or tray menu.".into());
    }
    let gateway_access = state
        .gateway
        .ensure_running(&settings)
        .await
        .map_err(map_err)?;
    let db_for_blocking = state.db.clone();
    let selections_for_blocking = args.context_selections.clone();
    let contexts = tauri::async_runtime::spawn_blocking(move || {
        resolve_contexts(&db_for_blocking, &selections_for_blocking)
    })
    .await
    .map_err(|e| format!("Context resolution task failed: {}", e))?
    .map_err(map_err)?;
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
            route
                .model
                .split_once('/')
                .map(|(provider, _)| (provider, route.model.as_str())),
            "streaming",
            None,
        )
        .map_err(map_err)?;
    let input = gateway::build_response_input(&history, &contexts, user_message);

    let stream_id = args.stream_id;
    let (cancel_tx, mut cancel_rx) = tokio::sync::watch::channel(false);
    if state
        .streams
        .lock()
        .insert(stream_id.clone(), cancel_tx)
        .is_some()
    {
        return Err("That chat stream is already active.".into());
    }

    let db = state.db.clone();
    let streams = state.streams.clone();
    let conversation_id = args.conversation_id;
    let assistant_id = draft.id;
    let stream_id_task = stream_id.clone();
    let app_task = app.clone();
    let partial = Arc::new(Mutex::new(String::new()));
    emit_orb_phase(
        &app,
        "generating",
        "Generating",
        "Bifrost is streaming a response.",
    );

    tauri::async_runtime::spawn(async move {
        enum Outcome {
            Completed(String),
            Cancelled,
            Failed(String),
        }
        let stream_partial = partial.clone();
        let persistence_partial = partial.clone();
        let persistence_db = db.clone();
        let persistence_id = assistant_id.clone();
        let (checkpoint_stop, mut checkpoint_stop_rx) = tokio::sync::watch::channel(false);
        let checkpoint_task = tauri::async_runtime::spawn(async move {
            let mut last_persisted = String::new();
            loop {
                tokio::select! {
                    _ = tokio::time::sleep(std::time::Duration::from_millis(750)) => {}
                    changed = checkpoint_stop_rx.changed() => {
                        if changed.is_err() || *checkpoint_stop_rx.borrow() {
                            break;
                        }
                    }
                }
                let text = persistence_partial.lock().clone();
                if text.is_empty() || text == last_persisted {
                    continue;
                }
                last_persisted.clone_from(&text);
                let checkpoint_db = persistence_db.clone();
                let checkpoint_id = persistence_id.clone();
                let _ = tauri::async_runtime::spawn_blocking(move || {
                    checkpoint_db.update_message_state(&checkpoint_id, &text, "streaming", None)
                })
                .await;
            }
        });
        let gateway_client = reqwest::Client::new();
        let streamed = gateway::stream_response(
            app_task.clone(),
            &gateway_client,
            gateway_access,
            route,
            input,
            &stream_id_task,
            move |text| {
                *stream_partial.lock() = text.to_string();
                Ok(())
            },
        );
        let outcome = tokio::select! {
            result = streamed => match result {
                Ok((text, _model)) => Outcome::Completed(text),
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
        let _ = checkpoint_stop.send(true);
        let _ = checkpoint_task.await;

        let (status, error, content) = match outcome {
            Outcome::Completed(content) => ("completed", None, content),
            Outcome::Cancelled => ("cancelled", None, partial.lock().clone()),
            Outcome::Failed(error) => ("failed", Some(error), partial.lock().clone()),
        };
        let persist_db = db.clone();
        let persist_id = assistant_id.clone();
        let persist_content = content.clone();
        let persist_error = error.clone();
        let persisted = tauri::async_runtime::spawn_blocking(move || {
            persist_db.update_message_state(
                &persist_id,
                &persist_content,
                status,
                persist_error.as_deref(),
            )
        })
        .await;
        streams.lock().remove(&stream_id_task);
        let terminal_error = match persisted {
            Ok(Ok(())) => error,
            Ok(Err(_)) | Err(_) => {
                Some("The response ended, but LightBridge could not persist it.".into())
            }
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
        emit_orb_phase(&app_task, "ready", "Ready", "LightBridge is active.");
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
    let settings = state.db.settings().map_err(map_err)?;
    if settings.route(&profile).is_none() {
        return Err("Unsupported model route.".into());
    }
    state
        .db
        .set_setting("ai_profile", &profile)
        .map_err(map_err)?;
    state.db.settings().map_err(map_err)
}

#[tauri::command]
pub fn set_model_routes(
    state: State<'_, AppState>,
    routes: Vec<ModelRoute>,
) -> Result<AppSettings, String> {
    if routes.is_empty() || routes.len() > 12 {
        return Err("Configure between one and twelve model routes.".into());
    }
    let mut ids = HashSet::new();
    for route in &routes {
        if route.id.trim().is_empty()
            || route.label.trim().is_empty()
            || !route.model.contains('/')
            || !ids.insert(route.id.clone())
        {
            return Err(
                "Every model route needs a unique ID, label, and provider-prefixed model.".into(),
            );
        }
        if !matches!(
            route.reasoning_effort.as_str(),
            "none" | "low" | "medium" | "high"
        ) {
            return Err("Reasoning effort must be none, low, medium, or high.".into());
        }
    }
    let current = state.db.settings().map_err(map_err)?;
    state
        .db
        .set_setting(
            "model_routes",
            &serde_json::to_string(&routes).map_err(map_err)?,
        )
        .map_err(map_err)?;
    if !routes.iter().any(|route| route.id == current.ai_profile) {
        state
            .db
            .set_setting("ai_profile", &routes[0].id)
            .map_err(map_err)?;
    }
    state.db.settings().map_err(map_err)
}

#[tauri::command]
pub async fn set_gateway_config(
    app: AppHandle,
    state: State<'_, AppState>,
    mode: String,
    external_url: Option<String>,
    auth_mode: String,
    auth_secret: Option<String>,
) -> Result<GatewayStatus, String> {
    if !matches!(mode.as_str(), "managed" | "external") {
        return Err("Gateway mode must be managed or external.".into());
    }
    if !matches!(auth_mode.as_str(), "none" | "bearer" | "basic") {
        return Err("Unsupported gateway authentication mode.".into());
    }
    if mode == "external" {
        let url = external_url
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "Enter an external Bifrost URL.".to_string())?;
        let parsed = reqwest::Url::parse(url).map_err(|_| "Enter a valid gateway URL.")?;
        let host = parsed.host_str().unwrap_or_default();
        let loopback = matches!(host, "127.0.0.1" | "localhost" | "::1");
        if parsed.scheme() != "https" && !(parsed.scheme() == "http" && loopback) {
            return Err("Remote gateways must use HTTPS.".into());
        }
        if auth_mode != "none" && auth_secret.as_deref().unwrap_or("").trim().is_empty() {
            return Err("Enter the external gateway credential.".into());
        }
    }
    if let Some(secret) = auth_secret.as_deref() {
        secrets::set_external_gateway_auth(secret).map_err(map_err)?;
    } else if auth_mode == "none" {
        secrets::set_external_gateway_auth("").map_err(map_err)?;
    }
    state
        .db
        .set_setting("gateway_mode", &mode)
        .map_err(map_err)?;
    state
        .db
        .set_setting(
            "external_gateway_url",
            external_url.as_deref().unwrap_or("").trim(),
        )
        .map_err(map_err)?;
    state
        .db
        .set_setting("external_gateway_auth", &auth_mode)
        .map_err(map_err)?;
    state.gateway.stop();
    let settings = state.db.settings().map_err(map_err)?;
    let status = state.gateway.status(&settings).await;
    let _ = app.emit("gateway://status", &status);
    emit_orb_state(&app, state.inner(), Some(&status));
    Ok(status)
}

#[tauri::command]
pub fn set_overlay_preferences(
    app: AppHandle,
    state: State<'_, AppState>,
    preferences: OverlayPreferences,
) -> Result<AppSettings, String> {
    if !(72..=100).contains(&preferences.opacity) {
        return Err("Overlay opacity must be between 72% and 100%.".into());
    }
    if !matches!(preferences.orb_edge.as_str(), "left" | "right") {
        return Err("Orb edge must be left or right.".into());
    }
    state
        .db
        .set_setting(
            "overlay",
            &serde_json::to_string(&preferences).map_err(map_err)?,
        )
        .map_err(map_err)?;
    *state.paused.lock() = preferences.paused;
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_always_on_top(preferences.always_on_top);
    }
    if let Some(orb) = app.get_webview_window("orb") {
        if preferences.orb_enabled {
            let _ = orb.show();
        } else {
            let _ = orb.hide();
        }
    }
    emit_orb_state(&app, state.inner(), None);
    state.db.settings().map_err(map_err)
}

#[tauri::command]
pub fn set_appearance_preferences(
    state: State<'_, AppState>,
    preferences: AppearancePreferences,
) -> Result<AppSettings, String> {
    if !matches!(preferences.mode.as_str(), "system" | "light" | "dark") {
        return Err("Appearance mode must be system, light, or dark.".into());
    }
    state
        .db
        .set_setting(
            "appearance",
            &serde_json::to_string(&preferences).map_err(map_err)?,
        )
        .map_err(map_err)?;
    state.db.settings().map_err(map_err)
}

#[tauri::command]
pub fn toggle_pause(app: AppHandle, state: State<'_, AppState>) -> Result<OrbState, String> {
    let mut settings = state.db.settings().map_err(map_err)?;
    settings.overlay.paused = !settings.overlay.paused;
    state
        .db
        .set_setting(
            "overlay",
            &serde_json::to_string(&settings.overlay).map_err(map_err)?,
        )
        .map_err(map_err)?;
    *state.paused.lock() = settings.overlay.paused;
    let orb_state = orb_state_for(state.inner(), None);
    let _ = app.emit("orb://state", &orb_state);
    Ok(orb_state)
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
    if app.global_shortcut().is_registered(previous.as_str()) {
        if let Err(error) = app.global_shortcut().unregister(previous.as_str()) {
            let _ = app.global_shortcut().unregister(parsed);
            return Err(format!(
                "Could not replace the shortcut ({error}). The previous shortcut is still active."
            ));
        }
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
    show_overlay_window(&app)?;
    let _ = app.emit("overlay://capture-request", true);
    Ok(())
}

pub fn show_overlay_window(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    if !state.ready_surfaces.lock().contains("main") {
        state.requested_surfaces.lock().insert("main".into());
        return Ok(());
    }
    anchor_overlay(app)?;
    if let Some(window) = app.get_webview_window("main") {
        window.show().map_err(map_err)?;
        window.set_focus().map_err(map_err)?;
    }
    Ok(())
}

fn anchor_overlay(app: &AppHandle) -> Result<(), String> {
    let Some(orb) = app.get_webview_window("orb") else {
        return Ok(());
    };
    let Some(main) = app.get_webview_window("main") else {
        return Ok(());
    };
    let orb_position = orb.outer_position().map_err(map_err)?;
    let orb_size = orb.outer_size().map_err(map_err)?;
    let main_size = main.outer_size().map_err(map_err)?;
    let monitor = orb
        .current_monitor()
        .map_err(map_err)?
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return Ok(());
    };
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let gap = (12.0 * orb.scale_factor().unwrap_or(1.0)).round() as i32;
    let right_half = orb_position.x
        > monitor_position.x + (monitor_size.width.saturating_sub(orb_size.width) / 2) as i32;
    let x = if right_half {
        orb_position.x - main_size.width as i32 - gap
    } else {
        orb_position.x + orb_size.width as i32 + gap
    };
    let max_y = monitor_position.y + monitor_size.height.saturating_sub(main_size.height) as i32;
    let y = (orb_position.y - (main_size.height as i32 / 5))
        .clamp(monitor_position.y, max_y.max(monitor_position.y));
    main.set_position(Position::Physical(PhysicalPosition::new(x, y)))
        .map_err(map_err)
}

#[tauri::command]
pub fn hide_overlay(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.hide().map_err(map_err)?;
    }
    Ok(())
}

#[tauri::command]
pub fn toggle_overlay(app: AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Err("Overlay window is unavailable.".into());
    };
    if window.is_visible().map_err(map_err)? {
        window.hide().map_err(map_err)?;
    } else {
        show_overlay_window(&app)?;
    }
    Ok(())
}

#[tauri::command]
pub fn show_settings(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.requested_surfaces.lock().insert("settings".into());
    if let Some(overlay) = app.get_webview_window("main") {
        overlay.hide().map_err(map_err)?;
    }
    if let Some(window) = app.get_webview_window("settings") {
        if state.ready_surfaces.lock().contains("settings") {
            window.show().map_err(map_err)?;
            window.set_focus().map_err(map_err)?;
        }
        return Ok(());
    }
    WebviewWindowBuilder::new(&app, "settings", WebviewUrl::App("index.html".into()))
        .title("LightBridge Settings")
        .inner_size(900.0, 720.0)
        .min_inner_size(760.0, 620.0)
        .resizable(true)
        .decorations(false)
        .transparent(true)
        .visible(false)
        .center()
        .build()
        .map_err(map_err)?;
    Ok(())
}

#[tauri::command]
pub fn ready_to_show(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    surface: String,
) -> Result<(), String> {
    if window.label() != surface {
        return Err("Window readiness label mismatch.".into());
    }
    state.ready_surfaces.lock().insert(surface.clone());
    let requested = state.requested_surfaces.lock().remove(&surface);
    match surface.as_str() {
        "orb" => {
            window
                .set_size(Size::Logical(LogicalSize::new(48.0, 48.0)))
                .map_err(map_err)?;
            let settings = app.state::<AppState>().db.settings().map_err(map_err)?;
            if let Some(monitor) = app.primary_monitor().map_err(map_err)? {
                let position = monitor.position();
                let size = monitor.size();
                let orb_size = window.outer_size().map_err(map_err)?;
                let x = if settings.overlay.orb_edge == "left" {
                    position.x + 12
                } else {
                    position.x + size.width.saturating_sub(orb_size.width) as i32 - 12
                };
                let max_y = position.y + size.height.saturating_sub(orb_size.height) as i32 - 12;
                let y = (position.y + settings.overlay.orb_offset)
                    .clamp(position.y + 12, max_y.max(position.y + 12));
                window
                    .set_position(Position::Physical(PhysicalPosition::new(x, y)))
                    .map_err(map_err)?;
            }
            if settings.overlay.orb_enabled {
                window.show().map_err(map_err)?;
            }
        }
        "settings" if requested => {
            window.show().map_err(map_err)?;
            window.set_focus().map_err(map_err)?;
        }
        "settings" => {}
        "main" if std::env::var_os("LIGHTBRIDGE_E2E").is_some() => {
            window.show().map_err(map_err)?;
            window.set_focus().map_err(map_err)?;
        }
        "main" if requested => {
            anchor_overlay(&app)?;
            window.show().map_err(map_err)?;
            window.set_focus().map_err(map_err)?;
        }
        "main" => {}
        _ => return Err("Unsupported UI surface.".into()),
    }
    Ok(())
}

#[tauri::command]
pub fn snap_orb(app: AppHandle, state: State<'_, AppState>) -> Result<AppSettings, String> {
    let orb = app
        .get_webview_window("orb")
        .ok_or_else(|| "Orb window is unavailable.".to_string())?;
    let position = orb.outer_position().map_err(map_err)?;
    let size = orb.outer_size().map_err(map_err)?;
    let monitor = orb
        .current_monitor()
        .map_err(map_err)?
        .or_else(|| app.primary_monitor().ok().flatten())
        .ok_or_else(|| "No display is available.".to_string())?;
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let middle = monitor_position.x + (monitor_size.width.saturating_sub(size.width) / 2) as i32;
    let edge = if position.x <= middle {
        "left"
    } else {
        "right"
    };
    let x = if edge == "left" {
        monitor_position.x + 12
    } else {
        monitor_position.x + monitor_size.width.saturating_sub(size.width) as i32 - 12
    };
    let max_y = monitor_position.y + monitor_size.height.saturating_sub(size.height) as i32 - 12;
    let y = position
        .y
        .clamp(monitor_position.y + 12, max_y.max(monitor_position.y + 12));
    orb.set_position(Position::Physical(PhysicalPosition::new(x, y)))
        .map_err(map_err)?;
    let mut settings = state.db.settings().map_err(map_err)?;
    settings.overlay.orb_edge = edge.into();
    settings.overlay.orb_offset = y - monitor_position.y;
    state
        .db
        .set_setting(
            "overlay",
            &serde_json::to_string(&settings.overlay).map_err(map_err)?,
        )
        .map_err(map_err)?;
    state.db.settings().map_err(map_err)
}

#[tauri::command]
pub fn show_orb_menu(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let open =
        MenuItem::with_id(&app, "show", "Open LightBridge", true, None::<&str>).map_err(map_err)?;
    let capture = MenuItem::with_id(
        &app,
        "capture",
        "Capture current window",
        true,
        None::<&str>,
    )
    .map_err(map_err)?;
    let pause_label = if *state.paused.lock() {
        "Resume"
    } else {
        "Pause"
    };
    let pause =
        MenuItem::with_id(&app, "pause", pause_label, true, None::<&str>).map_err(map_err)?;
    let settings =
        MenuItem::with_id(&app, "settings", "Settings", true, None::<&str>).map_err(map_err)?;
    let quit = MenuItem::with_id(&app, "quit", "Quit", true, None::<&str>).map_err(map_err)?;
    let menu =
        Menu::with_items(&app, &[&open, &capture, &pause, &settings, &quit]).map_err(map_err)?;
    window.popup_menu(&menu).map_err(map_err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_ids_are_strict() {
        assert!(valid_provider_id("openrouter"));
        assert!(valid_provider_id("azure-openai"));
        assert!(!valid_provider_id("OpenAI"));
        assert!(!valid_provider_id("../openai"));
    }
}
