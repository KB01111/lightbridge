import { create } from 'zustand';
import type { CaptureRecord, ContextItem } from '../lib/ipc';

// Transient UI state only. Backend-owned state (conversations, messages,
// captures) is fetched with TanStack Query — do not mirror it here.

export type StreamState = 'idle' | 'streaming' | 'error';

interface AppState {
  expanded: boolean;
  composerValue: string;
  conversationId: string | null;
  model: string;
  streamId: string | null;
  streamState: StreamState;
  streamingText: string;
  streamError: string | null;
  capture: CaptureRecord | null;
  contextItems: ContextItem[];
  settingsOpen: boolean;

  setExpanded: (v: boolean) => void;
  setComposerValue: (v: string) => void;
  setConversationId: (v: string | null) => void;
  setModel: (v: string) => void;
  startStream: (streamId: string) => void;
  appendDelta: (delta: string) => void;
  finishStream: () => void;
  failStream: (message: string) => void;
  setCapture: (c: CaptureRecord | null) => void;
  setContextItems: (items: ContextItem[]) => void;
  toggleContextItem: (id: string) => void;
  removeContextItem: (id: string) => void;
  setSettingsOpen: (v: boolean) => void;
}

// Rough token estimate: ~4 chars per token for English text.
export const estimateTokens = (text: string): number =>
  Math.max(1, Math.ceil(text.length / 4));

export function contextFromCapture(c: CaptureRecord): ContextItem[] {
  const items: ContextItem[] = [
    {
      id: `${c.id}:window`,
      sourceType: 'window',
      sourceName: `${c.window.appName} — ${c.window.title}`,
      createdAt: c.createdAt,
      included: true,
      tokenEstimate: estimateTokens(c.window.title) + 16,
      privacy: 'local',
      preview: c.window.title,
      contentHash: c.contentHash,
      sourceRef: `capture:${c.id}`,
      content: `Active window: ${c.window.appName} (${c.window.processPath}), title: "${c.window.title}", bounds ${c.window.width}x${c.window.height} @ DPI ${c.window.dpi} on ${c.window.monitor}.`,
    },
    {
      id: `${c.id}:screenshot`,
      sourceType: 'screenshot',
      sourceName: 'Screenshot',
      createdAt: c.createdAt,
      included: true,
      tokenEstimate: 0,
      privacy: 'sensitive',
      preview: 'Window capture image',
      contentHash: c.contentHash,
      sourceRef: `capture:${c.id}`,
      content: '',
    },
  ];
  if (c.ocrText != null && c.ocrText.trim().length > 0) {
    items.push({
      id: `${c.id}:ocr`,
      sourceType: 'ocr',
      sourceName: 'On-screen text (OCR)',
      createdAt: c.createdAt,
      included: true,
      tokenEstimate: estimateTokens(c.ocrText),
      privacy: 'sensitive',
      preview: c.ocrText.slice(0, 140),
      contentHash: c.contentHash,
      sourceRef: `capture:${c.id}`,
      content: c.ocrText,
    });
  }
  return items;
}

export const useAppStore = create<AppState>((set) => ({
  expanded: false,
  composerValue: '',
  conversationId: null,
  model: 'gpt-4o-mini',
  streamId: null,
  streamState: 'idle',
  streamingText: '',
  streamError: null,
  capture: null,
  contextItems: [],
  settingsOpen: false,

  setExpanded: (v) => set({ expanded: v }),
  setComposerValue: (v) => set({ composerValue: v }),
  setConversationId: (v) => set({ conversationId: v }),
  setModel: (v) => set({ model: v }),
  startStream: (streamId) =>
    set({ streamId, streamState: 'streaming', streamingText: '', streamError: null }),
  appendDelta: (delta) =>
    set((s) => ({ streamingText: s.streamingText + delta })),
  finishStream: () =>
    set({ streamId: null, streamState: 'idle', streamingText: '' }),
  failStream: (message) =>
    set({ streamId: null, streamState: 'error', streamError: message }),
  setCapture: (c) => set({ capture: c }),
  setContextItems: (items) => set({ contextItems: items }),
  toggleContextItem: (id) =>
    set((s) => ({
      contextItems: s.contextItems.map((it) =>
        it.id === id ? { ...it, included: !it.included } : it,
      ),
    })),
  removeContextItem: (id) =>
    set((s) => ({ contextItems: s.contextItems.filter((it) => it.id !== id) })),
  setSettingsOpen: (v) => set({ settingsOpen: v }),
}));
