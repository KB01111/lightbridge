mod capture;
mod commands;
mod db;
mod models;
mod ocr;
mod openai;
mod secrets;
mod state;

use std::path::PathBuf;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::state::AppState;

fn app_data_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("LightBridge")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "lightbridge=info,warn".into()),
        )
        .init();

    let data_dir = app_data_dir();
    let database = db::Db::open(&data_dir).expect("open LightBridge database");
    let app_state = AppState::new(database);

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    let expected =
                        Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);
                    if shortcut != &expected {
                        return;
                    }
                    let handle = app.clone();
                    // Remember HWND before LightBridge receives focus
                    if let Some(state) = handle.try_state::<AppState>() {
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
                    let _ = handle.emit("overlay://shown", true);
                    let _ = handle.emit("shortcut-toggle", true);
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
            commands::get_last_capture,
            commands::delete_capture,
            commands::search_memory,
            commands::export_data,
            commands::delete_all_data,
            commands::capture_foreground,
            commands::start_chat,
            commands::cancel_chat,
            commands::clear_api_key,
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

            let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);
            app.global_shortcut().register(shortcut)?;

            // Prewarm: keep window created but hidden
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.hide();
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running LightBridge");
}
