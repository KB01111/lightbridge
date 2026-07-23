mod capture;
mod commands;
mod db;
mod models;
mod ocr;
mod openai;
mod secrets;
mod state;

use std::path::PathBuf;
use std::str::FromStr;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
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
    let settings = database.settings().expect("load LightBridge settings");
    let _ = database.prune_captures(settings.capture_retention_days);
    let app_state = AppState::new(database, settings.shortcut.clone());

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    let handle = app.clone();
                    if let Some(state) = handle.try_state::<AppState>() {
                        let active = state.active_shortcut.lock().clone();
                        if Shortcut::from_str(&active).ok().as_ref() != Some(shortcut) {
                            return;
                        }
                        if let Ok(info) = capture::resolve_foreground_window(None) {
                            if !capture::is_self_window(&info) {
                                *state.pending_target_hwnd.lock() = Some(info.hwnd);
                            }
                        }
                    }
                    if let Some(win) = handle.get_webview_window("main") {
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                    let _ = handle.emit("overlay://capture-request", true);
                })
                .build(),
        )
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            commands::get_product_info,
            commands::has_api_key,
            commands::set_api_key,
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
            commands::clear_api_key,
            commands::get_settings,
            commands::set_ai_profile,
            commands::set_capture_retention,
            commands::acknowledge_privacy,
            commands::set_last_active_conversation,
            commands::set_shortcut,
            commands::remember_target_hwnd,
            commands::show_overlay,
            commands::hide_overlay,
        ])
        .setup(|app| {
            let show_i = MenuItem::with_id(app, "show", "Show LightBridge", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("LightBridge")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
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

            // Prewarm in production; WebDriver acceptance needs a visible surface.
            if let Some(win) = app.get_webview_window("main") {
                if std::env::var_os("LIGHTBRIDGE_E2E").is_some() {
                    let _ = win.show();
                    let _ = win.set_focus();
                } else {
                    let _ = win.hide();
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running LightBridge");
}
