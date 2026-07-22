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
  sourceType:
    | 'application'
    | 'window'
    | 'screenshot'
    | 'ocr'
    | 'clipboard'
    | 'conversation'
    | 'capture-history'
    | 'document'
    | 'memory'
    | 'pinned';
  sourceName: string;
  createdAt: string;
  included: boolean;
  tokenEstimate: number;
  privacy: 'local' | 'sensitive';
  preview: string;
  contentHash: string;
  sourceRef: string;
  content: string;
}

export interface ChatMessageRecord {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
}

export interface ConversationRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export const ipc = {
  // Capture / context
  getLastCapture: () => invoke<CaptureRecord | null>('get_last_capture'),
  captureForeground: () => invoke<CaptureRecord>('capture_foreground'),
  listCaptures: (limit: number, offset: number) =>
    invoke<CaptureRecord[]>('list_captures', { limit, offset }),
  deleteCapture: (id: string) => invoke<void>('delete_capture', { id }),

  // Conversations
  listConversations: () => invoke<ConversationRecord[]>('list_conversations'),
  createConversation: (title: string) =>
    invoke<ConversationRecord>('create_conversation', { title }),
  listMessages: (conversationId: string) =>
    invoke<ChatMessageRecord[]>('list_messages', { conversationId }),
  deleteConversation: (id: string) => invoke<void>('delete_conversation', { id }),

  // Chat streaming: backend emits chat://delta, chat://done, chat://error
  startChat: (args: {
    conversationId: string;
    userMessage: string;
    contextBlocks: string[];
    model: string;
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
  deleteAllData: () => invoke<void>('delete_all_data'),

  // Overlay control
  hideOverlay: () => invoke<void>('hide_overlay'),
};

export interface MemoryHit {
  kind: 'ocr' | 'message';
  refId: string;
  snippet: string;
  createdAt: string;
}

export interface ChatDelta {
  streamId: string;
  delta: string;
}

export interface ChatDone {
  streamId: string;
  messageId: string;
}

export interface ChatError {
  streamId: string;
  message: string;
}

export const events = {
  onCapture: (cb: (c: CaptureRecord) => void): Promise<UnlistenFn> =>
    listen<CaptureRecord>('context://captured', (e) => cb(e.payload)),
  onOcrUpdated: (cb: (c: CaptureRecord) => void): Promise<UnlistenFn> =>
    listen<CaptureRecord>('context://ocr-updated', (e) => cb(e.payload)),
  onChatDelta: (cb: (d: ChatDelta) => void): Promise<UnlistenFn> =>
    listen<ChatDelta>('chat://delta', (e) => cb(e.payload)),
  onChatDone: (cb: (d: ChatDone) => void): Promise<UnlistenFn> =>
    listen<ChatDone>('chat://done', (e) => cb(e.payload)),
  onChatError: (cb: (d: ChatError) => void): Promise<UnlistenFn> =>
    listen<ChatError>('chat://error', (e) => cb(e.payload)),
  onOverlayShown: (cb: () => void): Promise<UnlistenFn> =>
    listen('overlay://shown', () => cb()),
};
