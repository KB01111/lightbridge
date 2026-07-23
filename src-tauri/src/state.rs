use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::Mutex;
use tokio::sync::watch;

use crate::db::Db;

pub struct AppState {
    pub db: Arc<Db>,
    /// Active chat stream cancellation: stream_id -> sender(false to cancel)
    pub streams: Arc<Mutex<HashMap<String, watch::Sender<bool>>>>,
    /// HWND captured just before overlay focus (set by shortcut path).
    pub pending_target_hwnd: Arc<Mutex<Option<u64>>>,
    pub active_shortcut: Arc<Mutex<String>>,
}

impl AppState {
    pub fn new(db: Db, shortcut: String) -> Self {
        Self {
            db: Arc::new(db),
            streams: Arc::new(Mutex::new(HashMap::new())),
            pending_target_hwnd: Arc::new(Mutex::new(None)),
            active_shortcut: Arc::new(Mutex::new(shortcut)),
        }
    }
}
