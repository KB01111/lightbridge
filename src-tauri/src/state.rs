use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::Mutex;
use tokio::sync::watch;

use crate::db::Db;

pub struct AppState {
    pub db: Arc<Db>,
    /// Active chat stream cancellation: stream_id -> sender(false to cancel)
    pub streams: Mutex<HashMap<String, watch::Sender<bool>>>,
    /// HWND captured just before overlay focus (set by shortcut path).
    pub pending_target_hwnd: Mutex<Option<u64>>,
}

impl AppState {
    pub fn new(db: Db) -> Self {
        Self {
            db: Arc::new(db),
            streams: Mutex::new(HashMap::new()),
            pending_target_hwnd: Mutex::new(None),
        }
    }
}
