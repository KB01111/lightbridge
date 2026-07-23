import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

// Typed wrappers over the narrow Tauri command surface exposed by the
// LightBridge Rust host. Never widen these to generic invoke calls.

export interface WindowInfo {
  hwnd: number;
  processId: number;
  processPath: string;
  appName: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  dpi: number;
  monitor: string;
}

export interface CaptureRecord {
  id: string;
  window: WindowInfo;
  imagePath: string;
  previewBase64: string;
  contentHash: string;
  ocrText: string | null;
  ocrStatus: 'pending' | 'done' | 'failed' | 'unsupported';
  createdAt: string;
}

export interface ContextItem {
  id: string;
  captureId: string;
  sourceType: ContextKind;
  sourceName: string;
  createdAt: string;
  included: boolean;
  tokenEstimate: number;
  privacy: 'local' | 'sensitive';
  preview: string;
  contentHash: string;
}

export type ContextKind = 'window' | 'screenshot' | 'ocr';

export interface ContextSelection {
  captureId: string;
  kind: ContextKind;
}

export type AiProfile = 'best' | 'balanced' | 'fast';
export type MessageStatus = 'streaming' | 'completed' | 'cancelled' | 'failed';

export interface ChatMessageRecord {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model: string | null;
  status: MessageStatus;
  error: string | null;
  createdAt: string;
}

export interface ConversationRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppSettings {
  shortcut: string;
  aiProfile: AiProfile;
  captureRetentionDays: number;
  privacyAcknowledged: boolean;
  lastActiveConversation: string | null;
}

export const ipc = {
  // Capture / context
  getLastCapture: () => invoke<CaptureRecord | null>('get_last_capture'),
  getCapture: (id: string) => invoke<CaptureRecord | null>('get_capture', { id }),
  captureForeground: () => invoke<CaptureRecord>('capture_foreground'),
  recapture: () => invoke<CaptureRecord>('recapture'),
  listCaptures: (limit: number, offset: number) =>
    invoke<CaptureRecord[]>('list_captures', { limit, offset }),
  deleteCapture: (id: string) => invoke<void>('delete_capture', { id }),

  // Conversations
  listConversations: () => invoke<ConversationRecord[]>('list_conversations'),
  createConversation: (title: string) =>
    invoke<ConversationRecord>('create_conversation', { title }),
  listMessages: (conversationId: string) =>
    invoke<ChatMessageRecord[]>('list_messages', { conversationId }),
  getConversationContext: (conversationId: string) =>
    invoke<ContextSelection[]>('get_conversation_context', { conversationId }),
  deleteConversation: (id: string) => invoke<void>('delete_conversation', { id }),

  // Chat streaming: backend emits deltas plus one persisted terminal event.
  startChat: (args: {
    streamId: string;
    conversationId: string;
    userMessage: string;
    contextSelections: ContextSelection[];
    profile: AiProfile;
  }) => invoke<string>('start_chat', args),
  cancelChat: (streamId: string) => invoke<void>('cancel_chat', { streamId }),

  // Secrets (stored in Windows Credential Manager, never returned to the UI)
  setApiKey: (key: string) => invoke<void>('set_api_key', { key }),
  hasApiKey: () => invoke<boolean>('has_api_key'),
  clearApiKey: () => invoke<void>('clear_api_key'),

  // Search (SQLite FTS5 across OCR + messages)
  searchMemory: (query: string, limit: number) =>
    invoke<MemoryHit[]>('search_memory', { query, limit }),

  // Data lifecycle
  exportData: () => invoke<string>('export_data'),
  exportDiagnostics: () => invoke<string>('export_diagnostics'),
  deleteAllData: () => invoke<void>('delete_all_data'),

  // Persisted app settings
  getSettings: () => invoke<AppSettings>('get_settings'),
  setShortcut: (shortcut: string) =>
    invoke<AppSettings>('set_shortcut', { shortcut }),
  setAiProfile: (profile: AiProfile) =>
    invoke<AppSettings>('set_ai_profile', { profile }),
  setCaptureRetention: (days: number) =>
    invoke<AppSettings>('set_capture_retention', { days }),
  acknowledgePrivacy: () => invoke<AppSettings>('acknowledge_privacy'),
  setLastActiveConversation: (conversationId: string | null) =>
    invoke<AppSettings>('set_last_active_conversation', { conversationId }),

  // Overlay control
  hideOverlay: () => invoke<void>('hide_overlay'),
};

export interface MemoryHit {
  kind: 'ocr' | 'message';
  refId: string;
  ownerId: string;
  sourceTitle: string;
  snippet: string;
  createdAt: string;
}

export interface ChatDelta {
  streamId: string;
  delta: string;
}

export interface ChatFinished {
  streamId: string;
  conversationId: string;
  messageId: string;
  status: MessageStatus;
  error: string | null;
}

export interface CaptureStatus {
  phase: 'idle' | 'capturing' | 'ocr' | 'ready' | 'failed';
  message: string;
}

export const events = {
  onCapture: (cb: (c: CaptureRecord) => void): Promise<UnlistenFn> =>
    listen<CaptureRecord>('context://captured', (e) => cb(e.payload)),
  onOcrUpdated: (cb: (c: CaptureRecord) => void): Promise<UnlistenFn> =>
    listen<CaptureRecord>('context://ocr-updated', (e) => cb(e.payload)),
  onChatDelta: (cb: (d: ChatDelta) => void): Promise<UnlistenFn> =>
    listen<ChatDelta>('chat://delta', (e) => cb(e.payload)),
  onChatFinished: (cb: (d: ChatFinished) => void): Promise<UnlistenFn> =>
    listen<ChatFinished>('chat://finished', (e) => cb(e.payload)),
  onCaptureStatus: (cb: (status: CaptureStatus) => void): Promise<UnlistenFn> =>
    listen<CaptureStatus>('capture://status', (e) => cb(e.payload)),
  onCaptureRequest: (cb: () => void): Promise<UnlistenFn> =>
    listen('overlay://capture-request', () => cb()),
};
