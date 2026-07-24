import { create } from 'zustand';
import type {
  CaptureRecord,
  CaptureStatus,
  ContextSelection,
  ContextItem,
  MessageStatus,
  RouteId,
} from '../lib/ipc';

export type StreamState = 'idle' | 'streaming' | 'error';

interface AppState {
  composerValue: string;
  conversationId: string | null;
  routeId: RouteId;
  streamId: string | null;
  streamState: StreamState;
  streamingText: string;
  streamError: string | null;
  capture: CaptureRecord | null;
  contextItems: ContextItem[];
  libraryOpen: boolean;
  privacyOpen: boolean;
  captureStatus: CaptureStatus;

  setComposerValue: (value: string) => void;
  setConversationId: (value: string | null) => void;
  setRouteId: (value: RouteId) => void;
  startStream: (streamId: string) => void;
  appendDelta: (delta: string) => void;
  finishStream: (status: MessageStatus, error: string | null) => void;
  failStream: (message: string) => void;
  setCapture: (capture: CaptureRecord | null) => void;
  setContextItems: (items: ContextItem[]) => void;
  toggleContextItem: (id: string) => void;
  removeContextItem: (id: string) => void;
  setLibraryOpen: (value: boolean) => void;
  setPrivacyOpen: (value: boolean) => void;
  setCaptureStatus: (status: CaptureStatus) => void;
}

export const estimateTokens = (text: string): number =>
  text.length === 0 ? 0 : Math.ceil(text.length / 4);

export function contextFromCapture(capture: CaptureRecord): ContextItem[] {
  const items: ContextItem[] = [
    {
      id: `${capture.id}:window`,
      captureId: capture.id,
      sourceType: 'window',
      sourceName: `${capture.window.appName} — ${capture.window.title}`,
      createdAt: capture.createdAt,
      included: true,
      tokenEstimate: estimateTokens(capture.window.title) + 16,
      privacy: 'local',
      preview: capture.window.title,
      contentHash: capture.contentHash,
    },
    {
      id: `${capture.id}:screenshot`,
      captureId: capture.id,
      sourceType: 'screenshot',
      sourceName: 'Screenshot',
      createdAt: capture.createdAt,
      included: true,
      tokenEstimate: 0,
      privacy: 'sensitive',
      preview: 'Window capture image',
      contentHash: capture.contentHash,
    },
  ];
  if (capture.ocrText != null && capture.ocrText.trim().length > 0) {
    items.push({
      id: `${capture.id}:ocr`,
      captureId: capture.id,
      sourceType: 'ocr',
      sourceName: 'On-screen text (OCR)',
      createdAt: capture.createdAt,
      included: true,
      tokenEstimate: estimateTokens(capture.ocrText),
      privacy: 'sensitive',
      preview: capture.ocrText.slice(0, 140),
      contentHash: capture.contentHash,
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
  return {
    capture: captures.find((capture) => capture != null) ?? null,
    items,
  };
}

export const useAppStore = create<AppState>((set) => ({
  composerValue: '',
  conversationId: null,
  routeId: 'best',
  streamId: null,
  streamState: 'idle',
  streamingText: '',
  streamError: null,
  capture: null,
  contextItems: [],
  libraryOpen: false,
  privacyOpen: false,
  captureStatus: { phase: 'idle', message: 'Ready to capture.' },

  setComposerValue: (composerValue) => set({ composerValue }),
  setConversationId: (conversationId) => set({ conversationId }),
  setRouteId: (routeId) => set({ routeId }),
  startStream: (streamId) =>
    set({
      streamId,
      streamState: 'streaming',
      streamingText: '',
      streamError: null,
    }),
  appendDelta: (delta) =>
    set((state) => ({ streamingText: state.streamingText + delta })),
  finishStream: (status, error) =>
    set({
      streamId: null,
      streamState: status === 'failed' ? 'error' : 'idle',
      streamingText: '',
      streamError: error,
    }),
  failStream: (message) =>
    set({ streamId: null, streamState: 'error', streamError: message }),
  setCapture: (capture) => set({ capture }),
  setContextItems: (contextItems) => set({ contextItems }),
  toggleContextItem: (id) =>
    set((state) => ({
      contextItems: state.contextItems.map((item) =>
        item.id === id ? { ...item, included: !item.included } : item,
      ),
    })),
  removeContextItem: (id) =>
    set((state) => ({
      contextItems: state.contextItems.filter((item) => item.id !== id),
    })),
  setLibraryOpen: (libraryOpen) => set({ libraryOpen }),
  setPrivacyOpen: (privacyOpen) => set({ privacyOpen }),
  setCaptureStatus: (captureStatus) => set({ captureStatus }),
}));
