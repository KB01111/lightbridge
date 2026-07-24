use std::path::{Path, PathBuf};
use std::sync::Mutex;

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::models::{
    AppSettings, CaptureRecord, ChatMessageRecord, ContextSelection, ConversationRecord, MemoryHit,
    WindowInfo,
};

pub struct Db {
    conn: Mutex<Connection>,
    data_dir: PathBuf,
}

fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool> {
    let mut statement = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?;
        if name == column {
            return Ok(true);
        }
    }
    Ok(false)
}

impl Db {
    pub fn open(data_dir: &Path) -> Result<Self> {
        std::fs::create_dir_all(data_dir)?;
        let captures_dir = data_dir.join("captures");
        std::fs::create_dir_all(&captures_dir)?;
        let db_path = data_dir.join("lightbridge.sqlite3");
        let conn = Connection::open(&db_path)
            .with_context(|| format!("open sqlite {}", db_path.display()))?;
        conn.execute_batch(
            "
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;
            PRAGMA busy_timeout = 5000;
            ",
        )?;
        let db = Self {
            conn: Mutex::new(conn),
            data_dir: data_dir.to_path_buf(),
        };
        db.migrate()?;
        Ok(db)
    }

    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    pub fn captures_dir(&self) -> PathBuf {
        self.data_dir.join("captures")
    }

    fn migrate(&self) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS schema_migrations (
              version INTEGER PRIMARY KEY NOT NULL,
              applied_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS conversations (
              id TEXT PRIMARY KEY NOT NULL,
              title TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS messages (
              id TEXT PRIMARY KEY NOT NULL,
              conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
              role TEXT NOT NULL,
              content TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_messages_conversation
              ON messages(conversation_id, created_at);

            CREATE TABLE IF NOT EXISTS captures (
              id TEXT PRIMARY KEY NOT NULL,
              hwnd INTEGER NOT NULL,
              process_id INTEGER NOT NULL,
              process_path TEXT NOT NULL,
              app_name TEXT NOT NULL,
              title TEXT NOT NULL,
              x INTEGER NOT NULL,
              y INTEGER NOT NULL,
              width INTEGER NOT NULL,
              height INTEGER NOT NULL,
              dpi INTEGER NOT NULL,
              monitor TEXT NOT NULL,
              image_path TEXT NOT NULL,
              preview_base64 TEXT NOT NULL,
              content_hash TEXT NOT NULL,
              ocr_text TEXT,
              ocr_status TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_captures_created ON captures(created_at DESC);

            CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
              kind,
              ref_id,
              body,
              created_at UNINDEXED,
              tokenize = 'porter unicode61'
            );
            "#,
        )?;
        let applied: Option<i64> = conn
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |r| {
                r.get(0)
            })
            .optional()?
            .flatten();
        if applied.unwrap_or(0) < 1 {
            conn.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (1, ?1)",
                params![Utc::now().to_rfc3339()],
            )?;
        }
        if applied.unwrap_or(0) < 2 {
            let transaction = conn.transaction()?;
            if !column_exists(&transaction, "messages", "model")? {
                transaction.execute("ALTER TABLE messages ADD COLUMN model TEXT", [])?;
            }
            if !column_exists(&transaction, "messages", "status")? {
                transaction.execute(
                    "ALTER TABLE messages ADD COLUMN status TEXT NOT NULL DEFAULT 'completed'",
                    [],
                )?;
            }
            if !column_exists(&transaction, "messages", "error")? {
                transaction.execute("ALTER TABLE messages ADD COLUMN error TEXT", [])?;
            }
            transaction.execute_batch(
                r#"
                CREATE TABLE IF NOT EXISTS conversation_context (
                  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                  capture_id TEXT NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
                  kind TEXT NOT NULL CHECK(kind IN ('window', 'screenshot', 'ocr')),
                  selected_at TEXT NOT NULL,
                  PRIMARY KEY (conversation_id, capture_id, kind)
                );

                CREATE TABLE IF NOT EXISTS app_settings (
                  key TEXT PRIMARY KEY NOT NULL,
                  value TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );
                "#,
            )?;
            let now = Utc::now().to_rfc3339();
            for (key, value) in [
                ("shortcut", "Ctrl+Shift+Space"),
                ("ai_profile", "best"),
                ("capture_retention_days", "30"),
                ("privacy_acknowledged", "false"),
            ] {
                transaction.execute(
                    "INSERT OR IGNORE INTO app_settings(key, value, updated_at) VALUES (?1, ?2, ?3)",
                    params![key, value, now],
                )?;
            }
            transaction.execute(
                "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (2, ?1)",
                params![Utc::now().to_rfc3339()],
            )?;
            transaction.commit()?;
        }
        if applied.unwrap_or(0) < 3 {
            let transaction = conn.transaction()?;
            if !column_exists(&transaction, "messages", "provider")? {
                transaction.execute("ALTER TABLE messages ADD COLUMN provider TEXT", [])?;
            }
            transaction.execute(
                "UPDATE messages SET provider = 'openai'
                 WHERE provider IS NULL AND model LIKE 'gpt-%'",
                [],
            )?;
            let defaults = AppSettings::default();
            let now = Utc::now().to_rfc3339();
            for (key, value) in [
                ("gateway_mode", defaults.gateway_mode),
                ("external_gateway_url", String::new()),
                ("external_gateway_auth", defaults.external_gateway_auth),
                (
                    "configured_provider_ids",
                    serde_json::to_string(&defaults.configured_provider_ids)?,
                ),
                (
                    "model_routes",
                    serde_json::to_string(&defaults.model_routes)?,
                ),
                ("overlay", serde_json::to_string(&defaults.overlay)?),
                ("appearance", serde_json::to_string(&defaults.appearance)?),
            ] {
                transaction.execute(
                    "INSERT OR IGNORE INTO app_settings(key, value, updated_at) VALUES (?1, ?2, ?3)",
                    params![key, value, now],
                )?;
            }
            transaction.execute(
                "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (3, ?1)",
                params![Utc::now().to_rfc3339()],
            )?;
            transaction.commit()?;
        }
        Ok(())
    }

    pub fn reset_interrupted_streams(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE messages SET status = 'failed', error = 'Interrupted by app restart' WHERE status = 'streaming'",
            [],
        )?;
        Ok(())
    }

    pub fn insert_capture(&self, rec: &CaptureRecord) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            r#"
            INSERT INTO captures (
              id, hwnd, process_id, process_path, app_name, title,
              x, y, width, height, dpi, monitor,
              image_path, preview_base64, content_hash, ocr_text, ocr_status, created_at
            ) VALUES (
              ?1, ?2, ?3, ?4, ?5, ?6,
              ?7, ?8, ?9, ?10, ?11, ?12,
              ?13, ?14, ?15, ?16, ?17, ?18
            )
            "#,
            params![
                rec.id,
                rec.window.hwnd as i64,
                rec.window.process_id as i64,
                rec.window.process_path,
                rec.window.app_name,
                rec.window.title,
                rec.window.x,
                rec.window.y,
                rec.window.width,
                rec.window.height,
                rec.window.dpi as i64,
                rec.window.monitor,
                rec.image_path,
                rec.preview_base64,
                rec.content_hash,
                rec.ocr_text,
                rec.ocr_status,
                rec.created_at.to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn update_capture_ocr(
        &self,
        id: &str,
        ocr_text: Option<&str>,
        ocr_status: &str,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE captures SET ocr_text = ?1, ocr_status = ?2 WHERE id = ?3",
            params![ocr_text, ocr_status, id],
        )?;
        if let Some(text) = ocr_text {
            if !text.trim().is_empty() {
                conn.execute(
                    "INSERT INTO memory_fts(kind, ref_id, body, created_at) VALUES ('ocr', ?1, ?2, ?3)",
                    params![id, text, Utc::now().to_rfc3339()],
                )?;
            }
        }
        Ok(())
    }

    pub fn get_capture(&self, id: &str) -> Result<Option<CaptureRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"
            SELECT id, hwnd, process_id, process_path, app_name, title,
                   x, y, width, height, dpi, monitor,
                   image_path, preview_base64, content_hash, ocr_text, ocr_status, created_at
            FROM captures WHERE id = ?1
            "#,
        )?;
        let row = stmt.query_row(params![id], map_capture).optional()?;
        Ok(row)
    }

    pub fn last_capture(&self) -> Result<Option<CaptureRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"
            SELECT id, hwnd, process_id, process_path, app_name, title,
                   x, y, width, height, dpi, monitor,
                   image_path, preview_base64, content_hash, ocr_text, ocr_status, created_at
            FROM captures ORDER BY created_at DESC LIMIT 1
            "#,
        )?;
        let row = stmt.query_row([], map_capture).optional()?;
        Ok(row)
    }

    pub fn list_captures(&self, limit: i64, offset: i64) -> Result<Vec<CaptureRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"
            SELECT id, hwnd, process_id, process_path, app_name, title,
                   x, y, width, height, dpi, monitor,
                   image_path, preview_base64, content_hash, ocr_text, ocr_status, created_at
            FROM captures ORDER BY created_at DESC LIMIT ?1 OFFSET ?2
            "#,
        )?;
        let rows = stmt
            .query_map(params![limit, offset], map_capture)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn delete_capture(&self, id: &str) -> Result<()> {
        let path = {
            let conn = self.conn.lock().unwrap();
            let path: Option<String> = conn
                .query_row(
                    "SELECT image_path FROM captures WHERE id = ?1",
                    params![id],
                    |r| r.get(0),
                )
                .optional()?;
            conn.execute("DELETE FROM captures WHERE id = ?1", params![id])?;
            conn.execute(
                "DELETE FROM memory_fts WHERE kind = 'ocr' AND ref_id = ?1",
                params![id],
            )?;
            path
        };
        if let Some(p) = path {
            let _ = std::fs::remove_file(p);
        }
        Ok(())
    }

    pub fn create_conversation(&self, title: &str) -> Result<ConversationRecord> {
        let now = Utc::now();
        let rec = ConversationRecord {
            id: Uuid::new_v4().to_string(),
            title: title.to_string(),
            created_at: now,
            updated_at: now,
        };
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO conversations(id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![
                rec.id,
                rec.title,
                rec.created_at.to_rfc3339(),
                rec.updated_at.to_rfc3339()
            ],
        )?;
        Ok(rec)
    }

    pub fn list_conversations(&self) -> Result<Vec<ConversationRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC",
        )?;
        let rows = stmt
            .query_map([], |r| {
                Ok(ConversationRecord {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    created_at: parse_dt(&r.get::<_, String>(2)?)?,
                    updated_at: parse_dt(&r.get::<_, String>(3)?)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn delete_conversation(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM memory_fts WHERE kind = 'message' AND ref_id IN (SELECT id FROM messages WHERE conversation_id = ?1)",
            params![id],
        )?;
        conn.execute(
            "DELETE FROM messages WHERE conversation_id = ?1",
            params![id],
        )?;
        conn.execute("DELETE FROM conversations WHERE id = ?1", params![id])?;
        conn.execute(
            "UPDATE app_settings SET value = '', updated_at = ?1
             WHERE key = 'last_active_conversation' AND value = ?2",
            params![Utc::now().to_rfc3339(), id],
        )?;
        Ok(())
    }

    pub fn insert_message(
        &self,
        conversation_id: &str,
        role: &str,
        content: &str,
    ) -> Result<ChatMessageRecord> {
        self.insert_message_with_state(conversation_id, role, content, None, "completed", None)
    }

    pub fn insert_message_with_state(
        &self,
        conversation_id: &str,
        role: &str,
        content: &str,
        provider_model: Option<(&str, &str)>,
        status: &str,
        error: Option<&str>,
    ) -> Result<ChatMessageRecord> {
        let rec = ChatMessageRecord {
            id: Uuid::new_v4().to_string(),
            conversation_id: conversation_id.to_string(),
            role: role.to_string(),
            content: content.to_string(),
            provider: provider_model.map(|(provider, _)| provider.to_string()),
            model: provider_model.map(|(_, model)| model.to_string()),
            status: status.to_string(),
            error: error.map(str::to_string),
            created_at: Utc::now(),
        };
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO messages(id, conversation_id, role, content, provider, model, status, error, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                rec.id,
                rec.conversation_id,
                rec.role,
                rec.content,
                rec.provider,
                rec.model,
                rec.status,
                rec.error,
                rec.created_at.to_rfc3339(),
            ],
        )?;
        conn.execute(
            "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
            params![rec.created_at.to_rfc3339(), conversation_id],
        )?;
        if role != "system" && !content.trim().is_empty() {
            conn.execute(
                "INSERT INTO memory_fts(kind, ref_id, body, created_at) VALUES ('message', ?1, ?2, ?3)",
                params![rec.id, content, rec.created_at.to_rfc3339()],
            )?;
        }
        Ok(rec)
    }

    pub fn update_message_state(
        &self,
        id: &str,
        content: &str,
        status: &str,
        error: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "UPDATE messages SET content = ?1, status = ?2, error = ?3 WHERE id = ?4",
            params![content, status, error, id],
        )?;
        tx.execute(
            "DELETE FROM memory_fts WHERE kind = 'message' AND ref_id = ?1",
            params![id],
        )?;
        if !content.trim().is_empty() && status != "streaming" {
            tx.execute(
                "INSERT INTO memory_fts(kind, ref_id, body, created_at)
                 SELECT 'message', id, content, created_at FROM messages WHERE id = ?1",
                params![id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn list_messages(&self, conversation_id: &str) -> Result<Vec<ChatMessageRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, conversation_id, role, content, provider, model, status, error, created_at
             FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC",
        )?;
        let rows = stmt
            .query_map(params![conversation_id], |r| {
                Ok(ChatMessageRecord {
                    id: r.get(0)?,
                    conversation_id: r.get(1)?,
                    role: r.get(2)?,
                    content: r.get(3)?,
                    provider: r.get(4)?,
                    model: r.get(5)?,
                    status: r.get(6)?,
                    error: r.get(7)?,
                    created_at: parse_dt(&r.get::<_, String>(8)?)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn search_memory(&self, query: &str, limit: i64) -> Result<Vec<MemoryHit>> {
        let q = sanitize_fts(query);
        if q.is_empty() {
            return Ok(vec![]);
        }
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"
            SELECT f.kind,
                   f.ref_id,
                   CASE WHEN f.kind = 'message'
                     THEN COALESCE((SELECT m.conversation_id FROM messages m WHERE m.id = f.ref_id), '')
                     ELSE f.ref_id
                   END,
                   CASE WHEN f.kind = 'message'
                     THEN COALESCE((
                       SELECT c.title FROM messages m
                       JOIN conversations c ON c.id = m.conversation_id
                       WHERE m.id = f.ref_id
                     ), 'Conversation')
                     ELSE COALESCE((
                       SELECT c.app_name || ' — ' || c.title FROM captures c WHERE c.id = f.ref_id
                     ), 'Capture')
                   END,
                   snippet(memory_fts, 2, '[', ']', '…', 16),
                   f.created_at
            FROM memory_fts f
            WHERE memory_fts MATCH ?1
            ORDER BY rank
            LIMIT ?2
            "#,
        )?;
        let rows = stmt
            .query_map(params![q, limit], |r| {
                Ok(MemoryHit {
                    kind: r.get(0)?,
                    ref_id: r.get(1)?,
                    owner_id: r.get(2)?,
                    source_title: r.get(3)?,
                    snippet: r.get(4)?,
                    created_at: parse_dt(&r.get::<_, String>(5)?)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn set_conversation_context(
        &self,
        conversation_id: &str,
        selections: &[ContextSelection],
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "DELETE FROM conversation_context WHERE conversation_id = ?1",
            params![conversation_id],
        )?;
        for selection in selections {
            tx.execute(
                "INSERT OR IGNORE INTO conversation_context(conversation_id, capture_id, kind, selected_at)
                 VALUES (?1, ?2, ?3, ?4)",
                params![
                    conversation_id,
                    selection.capture_id,
                    selection.kind,
                    Utc::now().to_rfc3339()
                ],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn conversation_context(&self, conversation_id: &str) -> Result<Vec<ContextSelection>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT capture_id, kind FROM conversation_context
             WHERE conversation_id = ?1 ORDER BY selected_at, capture_id, kind",
        )?;
        let rows = stmt
            .query_map(params![conversation_id], |r| {
                Ok(ContextSelection {
                    capture_id: r.get(0)?,
                    kind: r.get(1)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    fn setting(&self, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        Ok(conn
            .query_row(
                "SELECT value FROM app_settings WHERE key = ?1",
                params![key],
                |r| r.get(0),
            )
            .optional()?)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO app_settings(key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![key, value, Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn settings(&self) -> Result<AppSettings> {
        let defaults = AppSettings::default();
        Ok(AppSettings {
            shortcut: self.setting("shortcut")?.unwrap_or(defaults.shortcut),
            ai_profile: self.setting("ai_profile")?.unwrap_or(defaults.ai_profile),
            capture_retention_days: self
                .setting("capture_retention_days")?
                .and_then(|value| value.parse().ok())
                .unwrap_or(defaults.capture_retention_days),
            privacy_acknowledged: self
                .setting("privacy_acknowledged")?
                .map(|value| value == "true")
                .unwrap_or(defaults.privacy_acknowledged),
            last_active_conversation: self
                .setting("last_active_conversation")?
                .filter(|value| !value.is_empty()),
            gateway_mode: self
                .setting("gateway_mode")?
                .unwrap_or(defaults.gateway_mode),
            external_gateway_url: self
                .setting("external_gateway_url")?
                .filter(|value| !value.is_empty()),
            external_gateway_auth: self
                .setting("external_gateway_auth")?
                .unwrap_or(defaults.external_gateway_auth),
            configured_provider_ids: self
                .setting("configured_provider_ids")?
                .and_then(|value| serde_json::from_str(&value).ok())
                .unwrap_or(defaults.configured_provider_ids),
            model_routes: self
                .setting("model_routes")?
                .and_then(|value| serde_json::from_str(&value).ok())
                .unwrap_or(defaults.model_routes),
            overlay: self
                .setting("overlay")?
                .and_then(|value| serde_json::from_str(&value).ok())
                .unwrap_or(defaults.overlay),
            appearance: self
                .setting("appearance")?
                .and_then(|value| serde_json::from_str(&value).ok())
                .unwrap_or(defaults.appearance),
        })
    }

    pub fn prune_captures(&self, retention_days: u32) -> Result<usize> {
        if retention_days == 0 {
            return Ok(0);
        }
        let cutoff = Utc::now() - chrono::Duration::days(retention_days as i64);
        let expired: Vec<String> = {
            let conn = self.conn.lock().unwrap();
            let mut stmt = conn.prepare("SELECT id FROM captures WHERE created_at < ?1")?;
            let rows = stmt
                .query_map(params![cutoff.to_rfc3339()], |r| r.get(0))?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };
        for id in &expired {
            self.delete_capture(id)?;
        }
        Ok(expired.len())
    }

    pub fn diagnostic_counts(&self) -> Result<serde_json::Value> {
        let conn = self.conn.lock().unwrap();
        let conversations: i64 =
            conn.query_row("SELECT COUNT(*) FROM conversations", [], |r| r.get(0))?;
        let messages: i64 = conn.query_row("SELECT COUNT(*) FROM messages", [], |r| r.get(0))?;
        let captures: i64 = conn.query_row("SELECT COUNT(*) FROM captures", [], |r| r.get(0))?;
        let interrupted: i64 = conn.query_row(
            "SELECT COUNT(*) FROM messages WHERE error = 'Interrupted by app restart'",
            [],
            |r| r.get(0),
        )?;
        Ok(serde_json::json!({
            "conversations": conversations,
            "messages": messages,
            "captures": captures,
            "recoveredInterruptedMessages": interrupted,
        }))
    }

    pub fn export_json(&self, export_path: &Path) -> Result<()> {
        let conversations = self.list_conversations()?;
        let captures = self.list_captures(10_000, 0)?;
        let mut messages = Vec::new();
        for c in &conversations {
            messages.extend(self.list_messages(&c.id)?);
        }
        let payload = serde_json::json!({
            "product": "LightBridge",
            "exportedAt": Utc::now().to_rfc3339(),
            "conversations": conversations,
            "messages": messages,
            "captures": captures.iter().map(|c| {
                serde_json::json!({
                    "id": c.id,
                    "window": c.window,
                    "imagePath": c.image_path,
                    "contentHash": c.content_hash,
                    "ocrText": c.ocr_text,
                    "ocrStatus": c.ocr_status,
                    "createdAt": c.created_at,
                })
            }).collect::<Vec<_>>(),
        });
        std::fs::write(export_path, serde_json::to_vec_pretty(&payload)?)?;
        Ok(())
    }

    pub fn delete_all_data(&self) -> Result<()> {
        {
            let conn = self.conn.lock().unwrap();
            conn.execute_batch(
                "
                DELETE FROM memory_fts;
                DELETE FROM messages;
                DELETE FROM conversations;
                DELETE FROM captures;
                UPDATE app_settings SET value = '', updated_at = CURRENT_TIMESTAMP
                  WHERE key = 'last_active_conversation';
                ",
            )?;
        }
        let dir = self.captures_dir();
        if dir.exists() {
            for entry in std::fs::read_dir(&dir)? {
                let entry = entry?;
                if entry.file_type()?.is_file() {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
        Ok(())
    }
}

fn map_capture(r: &rusqlite::Row<'_>) -> rusqlite::Result<CaptureRecord> {
    Ok(CaptureRecord {
        id: r.get(0)?,
        window: WindowInfo {
            hwnd: r.get::<_, i64>(1)? as u64,
            process_id: r.get::<_, i64>(2)? as u32,
            process_path: r.get(3)?,
            app_name: r.get(4)?,
            title: r.get(5)?,
            x: r.get(6)?,
            y: r.get(7)?,
            width: r.get(8)?,
            height: r.get(9)?,
            dpi: r.get::<_, i64>(10)? as u32,
            monitor: r.get(11)?,
        },
        image_path: r.get(12)?,
        preview_base64: r.get(13)?,
        content_hash: r.get(14)?,
        ocr_text: r.get(15)?,
        ocr_status: r.get(16)?,
        created_at: parse_dt(&r.get::<_, String>(17)?)?,
    })
}

fn parse_dt(s: &str) -> Result<DateTime<Utc>, rusqlite::Error> {
    DateTime::parse_from_rfc3339(s)
        .map(|d| d.with_timezone(&Utc))
        .or_else(|_| s.parse::<DateTime<Utc>>())
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))
}

fn sanitize_fts(query: &str) -> String {
    let cleaned: String = query
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c.is_whitespace() {
                c
            } else {
                ' '
            }
        })
        .collect();
    cleaned
        .split_whitespace()
        .map(|t| format!("\"{}\"", t.replace('"', "")))
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrate_and_roundtrip_conversation() {
        let dir = std::env::temp_dir().join(format!("lb-test-{}", Uuid::new_v4()));
        let db = Db::open(&dir).unwrap();
        let c = db.create_conversation("hello").unwrap();
        let list = db.list_conversations().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, c.id);
        let m = db.insert_message(&c.id, "user", "hi").unwrap();
        let msgs = db.list_messages(&c.id).unwrap();
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].id, m.id);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn recovers_partial_v2_migration_without_destroying_v1_data() {
        let dir = std::env::temp_dir().join(format!("lb-v1-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let conn = Connection::open(dir.join("lightbridge.sqlite3")).unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
            INSERT INTO schema_migrations VALUES (1, '2026-01-01T00:00:00Z');
            CREATE TABLE conversations (
              id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE messages (
              id TEXT PRIMARY KEY,
              conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
              role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE TABLE captures (
              id TEXT PRIMARY KEY, hwnd INTEGER NOT NULL, process_id INTEGER NOT NULL,
              process_path TEXT NOT NULL, app_name TEXT NOT NULL, title TEXT NOT NULL,
              x INTEGER NOT NULL, y INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
              dpi INTEGER NOT NULL, monitor TEXT NOT NULL, image_path TEXT NOT NULL,
              preview_base64 TEXT NOT NULL, content_hash TEXT NOT NULL, ocr_text TEXT,
              ocr_status TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE VIRTUAL TABLE memory_fts USING fts5(
              kind, ref_id, body, created_at UNINDEXED, tokenize = 'porter unicode61'
            );
            INSERT INTO conversations VALUES ('c1', 'Preserved', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
            INSERT INTO messages(id, conversation_id, role, content, created_at)
              VALUES ('m1', 'c1', 'user', 'still here', '2026-01-01T00:00:00Z');
            "#,
        )
        .unwrap();
        conn.execute("ALTER TABLE messages ADD COLUMN model TEXT", [])
            .unwrap();
        drop(conn);

        let db = Db::open(&dir).unwrap();
        let messages = db.list_messages("c1").unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].content, "still here");
        assert_eq!(messages[0].status, "completed");
        assert_eq!(db.settings().unwrap().ai_profile, "best");
        let version: i64 = db
            .conn
            .lock()
            .unwrap()
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, 3);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn memory_hits_include_navigable_owner_and_title() {
        let dir = std::env::temp_dir().join(format!("lb-search-test-{}", Uuid::new_v4()));
        let db = Db::open(&dir).unwrap();
        let conversation = db.create_conversation("Fixture chat").unwrap();
        db.insert_message(&conversation.id, "user", "unique lighthouse phrase")
            .unwrap();
        let hits = db.search_memory("lighthouse", 5).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].owner_id, conversation.id);
        assert_eq!(hits[0].source_title, "Fixture chat");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn conversation_context_roundtrips() {
        let dir = std::env::temp_dir().join(format!("lb-context-test-{}", Uuid::new_v4()));
        let db = Db::open(&dir).unwrap();
        let conversation = db.create_conversation("Context").unwrap();
        let capture = CaptureRecord {
            id: "capture-1".into(),
            window: WindowInfo {
                hwnd: 1,
                process_id: 2,
                process_path: "fixture.exe".into(),
                app_name: "fixture".into(),
                title: "Fixture".into(),
                x: 0,
                y: 0,
                width: 100,
                height: 100,
                dpi: 96,
                monitor: "100x100".into(),
            },
            image_path: dir.join("captures/capture-1.png").to_string_lossy().into(),
            preview_base64: "data:image/jpeg;base64,".into(),
            content_hash: "hash".into(),
            ocr_text: None,
            ocr_status: "pending".into(),
            created_at: Utc::now(),
        };
        db.insert_capture(&capture).unwrap();
        let selections = vec![ContextSelection {
            capture_id: capture.id,
            kind: "screenshot".into(),
        }];
        db.set_conversation_context(&conversation.id, &selections)
            .unwrap();
        assert_eq!(
            db.conversation_context(&conversation.id).unwrap(),
            selections
        );
        let _ = std::fs::remove_dir_all(dir);
    }
}
