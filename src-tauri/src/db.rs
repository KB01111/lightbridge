use std::path::{Path, PathBuf};
use std::sync::Mutex;

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::models::{CaptureRecord, ChatMessageRecord, ConversationRecord, MemoryHit, WindowInfo};

pub struct Db {
    conn: Mutex<Connection>,
    data_dir: PathBuf,
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
        let conn = self.conn.lock().unwrap();
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
        Ok(())
    }

    pub fn insert_message(
        &self,
        conversation_id: &str,
        role: &str,
        content: &str,
    ) -> Result<ChatMessageRecord> {
        let rec = ChatMessageRecord {
            id: Uuid::new_v4().to_string(),
            conversation_id: conversation_id.to_string(),
            role: role.to_string(),
            content: content.to_string(),
            created_at: Utc::now(),
        };
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO messages(id, conversation_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                rec.id,
                rec.conversation_id,
                rec.role,
                rec.content,
                rec.created_at.to_rfc3339()
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

    pub fn list_messages(&self, conversation_id: &str) -> Result<Vec<ChatMessageRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, conversation_id, role, content, created_at FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC",
        )?;
        let rows = stmt
            .query_map(params![conversation_id], |r| {
                Ok(ChatMessageRecord {
                    id: r.get(0)?,
                    conversation_id: r.get(1)?,
                    role: r.get(2)?,
                    content: r.get(3)?,
                    created_at: parse_dt(&r.get::<_, String>(4)?)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn search_memory(&self, query: &str, limit: i64) -> Result<Vec<MemoryHit>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"
            SELECT kind, ref_id, snippet(memory_fts, 2, '[', ']', '…', 16), created_at
            FROM memory_fts
            WHERE memory_fts MATCH ?1
            ORDER BY rank
            LIMIT ?2
            "#,
        )?;
        let q = sanitize_fts(query);
        if q.is_empty() {
            return Ok(vec![]);
        }
        let rows = stmt
            .query_map(params![q, limit], |r| {
                Ok(MemoryHit {
                    kind: r.get(0)?,
                    ref_id: r.get(1)?,
                    snippet: r.get(2)?,
                    created_at: parse_dt(&r.get::<_, String>(3)?)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
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
}
