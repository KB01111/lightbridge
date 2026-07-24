use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use parking_lot::Mutex;
use tokio::sync::watch;

use crate::db::Db;
use crate::gateway::GatewayManager;

pub struct AppState {
    pub db: Arc<Db>,
    /// Active chat stream cancellation: stream_id -> sender(false to cancel)
    pub streams: Arc<Mutex<HashMap<String, watch::Sender<bool>>>>,
    /// HWND captured just before overlay focus (set by shortcut path).
    pub pending_target_hwnd: Arc<Mutex<Option<u64>>>,
    /// Generation token for suppressing status events from stale OCR tasks.
    pub active_capture_operation: Arc<Mutex<Option<String>>>,
    pub active_shortcut: Arc<Mutex<String>>,
    pub gateway: Arc<GatewayManager>,
    pub paused: Arc<Mutex<bool>>,
    pub ready_surfaces: Arc<Mutex<HashSet<String>>>,
    pub requested_surfaces: Arc<Mutex<HashSet<String>>>,
}

impl AppState {
    pub fn new(db: Db, shortcut: String, paused: bool) -> anyhow::Result<Self> {
        let gateway = GatewayManager::new(db.data_dir())?;
        Ok(Self {
            db: Arc::new(db),
            streams: Arc::new(Mutex::new(HashMap::new())),
            pending_target_hwnd: Arc::new(Mutex::new(None)),
            active_capture_operation: Arc::new(Mutex::new(None)),
            active_shortcut: Arc::new(Mutex::new(shortcut)),
            gateway: Arc::new(gateway),
            paused: Arc::new(Mutex::new(paused)),
            ready_surfaces: Arc::new(Mutex::new(HashSet::new())),
            requested_surfaces: Arc::new(Mutex::new(HashSet::new())),
        })
    }
}
