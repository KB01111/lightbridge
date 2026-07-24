mod capture;
mod commands;
mod db;
mod gateway;
mod models;
mod ocr;
mod secrets;
mod state;

use std::path::PathBuf;
use std::str::FromStr;

use tauri::{
    menu::{Menu, MenuEvent, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, RunEvent, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::state::AppState;

fn app_data_dir() -> PathBuf {
    if let Some(path) = std::env::var_os("LIGHTBRIDGE_E2E_DATA_DIR") {
        return PathBuf::from(path);
    }
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("LightBridge")
}

fn remember_foreground(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(info) = capture::resolve_foreground_window(None) {
            if !capture::is_self_window(&info) {
                *state.pending_target_hwnd.lock() = Some(info.hwnd);
            }
        }
    }
}

fn show_and_capture(app: &tauri::AppHandle) {
    remember_foreground(app);
    let _ = commands::show_overlay_window(app);
    let _ = app.emit("overlay://capture-request", true);
}

fn handle_menu_event(app: &tauri::AppHandle, event: MenuEvent) {
    match event.id.as_ref() {
        "quit" => app.exit(0),
        "show" => {
            let _ = commands::show_overlay_window(app);
        }
        "capture" => show_and_capture(app),
        "settings" => {
            let state = app.state::<AppState>();
            let _ = commands::show_settings(app.clone(), state);
        }
        "pause" => {
            let state = app.state::<AppState>();
            let _ = commands::toggle_pause(app.clone(), state);
        }
        _ => {}
    }
}

static LOG_GUARD: once_cell::sync::OnceCell<tracing_appender::non_blocking::WorkerGuard> =
    once_cell::sync::OnceCell::new();

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let data_dir = app_data_dir();
    let log_dir = data_dir.join("logs");
    let _ = std::fs::create_dir_all(&log_dir);
    let file_appender = tracing_appender::rolling::daily(log_dir, "lightbridge.log");
    let (file_writer, guard) = tracing_appender::non_blocking(file_appender);
    let _ = LOG_GUARD.set(guard);
    tracing_subscriber::fmt()
        .with_writer(file_writer)
        .with_ansi(false)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "lightbridge=info,warn".into()),
        )
        .init();

    let database = db::Db::open(&data_dir).expect("open LightBridge database");
    let _ = database.reset_interrupted_streams();
    let migrated_openai = secrets::migrate_legacy_openai().unwrap_or(false);
    let mut settings = database.settings().expect("load LightBridge settings");
    if (migrated_openai || secrets::has_provider_credential("openai"))
        && !settings
            .configured_provider_ids
            .iter()
            .any(|provider| provider == "openai")
    {
        settings.configured_provider_ids.push("openai".into());
        settings.configured_provider_ids.sort();
        let _ = database.set_setting(
            "configured_provider_ids",
            &serde_json::to_string(&settings.configured_provider_ids).unwrap_or_default(),
        );
    }
    let _ = database.prune_captures(settings.capture_retention_days);
    let app_state = AppState::new(database, settings.shortcut.clone(), settings.overlay.paused)
        .expect("initialize gateway state");

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    if let Some(state) = app.try_state::<AppState>() {
                        let active = state.active_shortcut.lock().clone();
                        if Shortcut::from_str(&active).ok().as_ref() != Some(shortcut) {
                            return;
                        }
                    }
                    show_and_capture(app);
                })
                .build(),
        )
        .manage(app_state)
        .on_menu_event(handle_menu_event)
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if matches!(window.label(), "main" | "settings") {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_product_info,
            commands::has_api_key,
            commands::set_api_key,
            commands::clear_api_key,
            commands::list_provider_connections,
            commands::set_provider_credential,
            commands::remove_provider,
            commands::get_gateway_status,
            commands::get_orb_state,
            commands::install_gateway,
            commands::list_models,
            commands::set_gateway_config,
            commands::set_model_routes,
            commands::estimate_tokens,
            commands::list_conversations,
            commands::create_conversation,
            commands::delete_conversation,
            commands::list_messages,
            commands::list_captures,
            commands::get_capture,
            commands::get_last_capture,
            commands::delete_capture,
            commands::get_conversation_context,
            commands::search_memory,
            commands::export_data,
            commands::export_diagnostics,
            commands::delete_all_data,
            commands::capture_foreground,
            commands::recapture,
            commands::start_chat,
            commands::cancel_chat,
            commands::get_settings,
            commands::set_ai_profile,
            commands::set_overlay_preferences,
            commands::set_appearance_preferences,
            commands::toggle_pause,
            commands::set_capture_retention,
            commands::acknowledge_privacy,
            commands::set_last_active_conversation,
            commands::set_shortcut,
            commands::remember_target_hwnd,
            commands::show_overlay,
            commands::hide_overlay,
            commands::toggle_overlay,
            commands::show_settings,
            commands::ready_to_show,
            commands::snap_orb,
            commands::show_orb_menu,
        ])
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "Open LightBridge", true, None::<&str>)?;
            let capture =
                MenuItem::with_id(app, "capture", "Capture current window", true, None::<&str>)?;
            let pause = MenuItem::with_id(app, "pause", "Pause or resume", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &capture, &pause, &settings, &quit])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("LightBridge")
                .on_menu_event(handle_menu_event)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let _ = commands::show_overlay_window(tray.app_handle());
                    }
                })
                .build(app)?;

            let active_shortcut = app.state::<AppState>().active_shortcut.lock().clone();
            if let Err(error) = app.global_shortcut().register(active_shortcut.as_str()) {
                tracing::warn!(
                    shortcut = %active_shortcut,
                    error = %error,
                    "global shortcut unavailable; app remains usable from the tray"
                );
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("build LightBridge");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(state) = handle.try_state::<AppState>() {
                state.gateway.stop();
            }
        }
    });
}
