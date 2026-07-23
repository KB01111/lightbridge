import { create } from 'zustand';
import type {
  AiProfile,
  CaptureRecord,
  CaptureStatus,
  ContextSelection,
  ContextItem,
  MessageStatus,
} from '../lib/ipc';

// Transient UI state only. Backend-owned state (conversations, messages,
// captures) is fetched with TanStack Query — do not mirror it here.

export type StreamState = 'idle' | 'streaming' | 'error';

interface AppState {
  expanded: boolean;
  composerValue: string;
  conversationId: string | null;
  profile: AiProfile;
  streamId: string | null;
  streamState: StreamState;
  streamingText: string;
  streamError: string | null;
  capture: CaptureRecord | null;
  contextItems: ContextItem[];
  settingsOpen: boolean;
  libraryOpen: boolean;
  privacyOpen: boolean;
  captureStatus: CaptureStatus;

  setExpanded: (v: boolean) => void;
  setComposerValue: (v: string) => void;
  setConversationId: (v: string | null) => void;
  setProfile: (v: AiProfile) => void;
  startStream: (streamId: string) => void;
  appendDelta: (delta: string) => void;
  finishStream: (status: MessageStatus, error: string | null) => void;
  failStream: (message: string) => void;
  setCapture: (c: CaptureRecord | null) => void;
  setContextItems: (items: ContextItem[]) => void;
  toggleContextItem: (id: string) => void;
  removeContextItem: (id: string) => void;
  setSettingsOpen: (v: boolean) => void;
  setLibraryOpen: (v: boolean) => void;
  setPrivacyOpen: (v: boolean) => void;
  setCaptureStatus: (status: CaptureStatus) => void;
}

// Rough token estimate: ~4 chars per token for English text.
export const estimateTokens = (text: string): number =>
  text.length === 0 ? 0 : Math.ceil(text.length / 4);

export function contextFromCapture(c: CaptureRecord): ContextItem[] {
  const items: ContextItem[] = [
    {
      id: `${c.id}:window`,
      captureId: c.id,
      sourceType: 'window',
      sourceName: `${c.window.appName} — ${c.window.title}`,
      createdAt: c.createdAt,
      included: true,
      tokenEstimate: estimateTokens(c.window.title) + 16,
      privacy: 'local',
      preview: c.window.title,
      contentHash: c.contentHash,
    },
    {
      id: `${c.id}:screenshot`,
      captureId: c.id,
      sourceType: 'screenshot',
      sourceName: 'Screenshot',
      createdAt: c.createdAt,
      included: true,
      tokenEstimate: 0,
      privacy: 'sensitive',
      preview: 'Window capture image',
      contentHash: c.contentHash,
    },
  ];
  if (c.ocrText != null && c.ocrText.trim().length > 0) {
    items.push({
      id: `${c.id}:ocr`,
      captureId: c.id,
      sourceType: 'ocr',
      sourceName: 'On-screen text (OCR)',
      createdAt: c.createdAt,
      included: true,
      tokenEstimate: estimateTokens(c.ocrText),
      privacy: 'sensitive',
      preview: c.ocrText.slice(0, 140),
      contentHash: c.contentHash,
    });
  }
  return items;
}

export function selectionsFromContext(
  items: ContextItem[],
): ContextSelection[] {
  return items
    .filter((item) => item.included)
    .map((item) => ({
      captureId: item.captureId,
      kind: item.sourceType,
    }));
}

export async function resolveConversationContext(
  selections: ContextSelection[],
  getCapture: (id: string) => Promise<CaptureRecord | null>,
): Promise<{ capture: CaptureRecord | null; items: ContextItem[] }> {
  const captureIds = [
    ...new Set(selections.map((selection) => selection.captureId)),
  ];
  const captures = await Promise.all(
    captureIds.map((captureId) => getCapture(captureId)),
  );
  const selectedKeys = new Set(
    selections.map(
      (selection) => `${selection.captureId}:${selection.kind}`,
    ),
  );
  const items = captures
    .filter((capture) => capture != null)
    .flatMap(contextFromCapture)
    .filter((item) => selectedKeys.has(item.id));
  const capture = captures.find((capture) => capture != null) ?? null;
  return { capture, items };
}

export const useAppStore = create<AppState>((set) => ({
  expanded: false,
  composerValue: '',
  conversationId: null,
  profile: 'best',
  streamId: null,
  streamState: 'idle',
  streamingText: '',
  streamError: null,
  capture: null,
  contextItems: [],
  settingsOpen: false,
  libraryOpen: false,
  privacyOpen: false,
  captureStatus: { phase: 'idle', message: 'Ready to capture.' },

  setExpanded: (v) => set({ expanded: v }),
  setComposerValue: (v) => set({ composerValue: v }),
  setConversationId: (v) => set({ conversationId: v }),
  setProfile: (v) => set({ profile: v }),
  startStream: (streamId) =>
    set({ streamId, streamState: 'streaming', streamingText: '', streamError: null }),
  appendDelta: (delta) =>
    set((s) => ({ streamingText: s.streamingText + delta })),
  finishStream: (status, error) =>
    set({
      streamId: null,
      streamState: status === 'failed' ? 'error' : 'idle',
      streamingText: '',
      streamError: error,
    }),
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
  setLibraryOpen: (v) => set({ libraryOpen: v }),
  setPrivacyOpen: (v) => set({ privacyOpen: v }),
  setCaptureStatus: (status) => set({ captureStatus: status }),
}));
