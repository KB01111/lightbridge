import { invoke } from '@tauri-apps/api/core';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';

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

export type ContextKind = 'window' | 'screenshot' | 'ocr';

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

export interface ContextSelection {
  captureId: string;
  kind: ContextKind;
}

export type RouteId = string;
export type MessageStatus = 'streaming' | 'completed' | 'cancelled' | 'failed';

export interface ChatMessageRecord {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  provider: string | null;
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

export interface ModelRoute {
  id: string;
  label: string;
  model: string;
  fallbackModels: string[];
  reasoningEffort: 'none' | 'low' | 'medium' | 'high';
}

export interface OverlayPreferences {
  opacity: number;
  alwaysOnTop: boolean;
  orbEnabled: boolean;
  orbEdge: 'left' | 'right';
  orbOffset: number;
  paused: boolean;
}

export interface AppearancePreferences {
  mode: 'system' | 'light' | 'dark';
  reducedMotion: boolean;
}

export interface AppSettings {
  shortcut: string;
  aiProfile: RouteId;
  captureRetentionDays: number;
  privacyAcknowledged: boolean;
  lastActiveConversation: string | null;
  gatewayMode: 'managed' | 'external';
  externalGatewayUrl: string | null;
  externalGatewayAuth: 'none' | 'bearer' | 'basic';
  configuredProviderIds: string[];
  modelRoutes: ModelRoute[];
  overlay: OverlayPreferences;
  appearance: AppearancePreferences;
}

export interface ProviderDescriptor {
  id: string;
  label: string;
  description: string;
  credentialLabel: string;
  credentialPlaceholder: string;
  isLocal: boolean;
  isCurated: boolean;
}

export interface ProviderConnection {
  provider: ProviderDescriptor;
  isConfigured: boolean;
  baseUrl: string | null;
  status: 'connected' | 'notConfigured' | 'error';
}

export interface ModelDescriptor {
  id: string;
  provider: string;
  label: string;
}

export type GatewayPhase =
  | 'setupRequired'
  | 'notInstalled'
  | 'downloading'
  | 'starting'
  | 'ready'
  | 'offline';

export interface GatewayStatus {
  mode: 'managed' | 'external';
  phase: GatewayPhase;
  message: string;
  version: string | null;
  endpoint: string | null;
  installed: boolean;
  healthy: boolean;
  configuredProviders: number;
}

export interface GatewayInstallProgress {
  phase: 'downloading' | 'verifying' | 'complete';
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
  message: string;
}

export type OrbPhase =
  | 'ready'
  | 'capturing'
  | 'generating'
  | 'paused'
  | 'setupRequired'
  | 'offline'
  | 'error';

export interface OrbState {
  phase: OrbPhase;
  label: string;
  detail: string;
}

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

export const ipc = {
  getLastCapture: () => invoke<CaptureRecord | null>('get_last_capture'),
  getCapture: (id: string) => invoke<CaptureRecord | null>('get_capture', { id }),
  captureForeground: () => invoke<CaptureRecord>('capture_foreground'),
  recapture: () => invoke<CaptureRecord>('recapture'),
  listCaptures: (limit: number, offset: number) =>
    invoke<CaptureRecord[]>('list_captures', { limit, offset }),
  deleteCapture: (id: string) => invoke<void>('delete_capture', { id }),

  listConversations: () => invoke<ConversationRecord[]>('list_conversations'),
  createConversation: (title: string) =>
    invoke<ConversationRecord>('create_conversation', { title }),
  listMessages: (conversationId: string) =>
    invoke<ChatMessageRecord[]>('list_messages', { conversationId }),
  getConversationContext: (conversationId: string) =>
    invoke<ContextSelection[]>('get_conversation_context', { conversationId }),
  deleteConversation: (id: string) => invoke<void>('delete_conversation', { id }),

  startChat: (args: {
    streamId: string;
    conversationId: string;
    userMessage: string;
    contextSelections: ContextSelection[];
    routeId: RouteId;
  }) => invoke<string>('start_chat', { args }),
  cancelChat: (streamId: string) => invoke<void>('cancel_chat', { streamId }),

  listProviderConnections: () =>
    invoke<ProviderConnection[]>('list_provider_connections'),
  setProviderCredential: (providerId: string, credential: string) =>
    invoke<GatewayStatus>('set_provider_credential', {
      providerId,
      credential,
    }),
  removeProvider: (providerId: string) =>
    invoke<GatewayStatus>('remove_provider', { providerId }),
  getGatewayStatus: () => invoke<GatewayStatus>('get_gateway_status'),
  installGateway: () => invoke<GatewayStatus>('install_gateway'),
  listModels: () => invoke<ModelDescriptor[]>('list_models'),
  setGatewayConfig: (args: {
    mode: 'managed' | 'external';
    externalUrl: string | null;
    authMode: 'none' | 'bearer' | 'basic';
    authSecret: string | null;
  }) => invoke<GatewayStatus>('set_gateway_config', args),
  setModelRoutes: (routes: ModelRoute[]) =>
    invoke<AppSettings>('set_model_routes', { routes }),

  searchMemory: (query: string, limit: number) =>
    invoke<MemoryHit[]>('search_memory', { query, limit }),
  exportData: () => invoke<string>('export_data'),
  exportDiagnostics: () => invoke<string>('export_diagnostics'),
  deleteAllData: () => invoke<void>('delete_all_data'),

  getSettings: () => invoke<AppSettings>('get_settings'),
  setShortcut: (shortcut: string) =>
    invoke<AppSettings>('set_shortcut', { shortcut }),
  setAiProfile: (profile: RouteId) =>
    invoke<AppSettings>('set_ai_profile', { profile }),
  setCaptureRetention: (days: number) =>
    invoke<AppSettings>('set_capture_retention', { days }),
  setOverlayPreferences: (preferences: OverlayPreferences) =>
    invoke<AppSettings>('set_overlay_preferences', { preferences }),
  setAppearancePreferences: (preferences: AppearancePreferences) =>
    invoke<AppSettings>('set_appearance_preferences', { preferences }),
  acknowledgePrivacy: () => invoke<AppSettings>('acknowledge_privacy'),
  setLastActiveConversation: (conversationId: string | null) =>
    invoke<AppSettings>('set_last_active_conversation', { conversationId }),

  hideOverlay: () => invoke<void>('hide_overlay'),
  toggleOverlay: () => invoke<void>('toggle_overlay'),
  showSettings: () => invoke<void>('show_settings'),
  togglePause: () => invoke<OrbState>('toggle_pause'),
  getOrbState: () => invoke<OrbState>('get_orb_state'),
  readyToShow: (surface: string) =>
    invoke<void>('ready_to_show', { surface }),
  snapOrb: () => invoke<AppSettings>('snap_orb'),
  showOrbMenu: () => invoke<void>('show_orb_menu'),
  notifySettingsChanged: () => emit('settings://changed'),
};

export const events = {
  onCapture: (cb: (capture: CaptureRecord) => void): Promise<UnlistenFn> =>
    listen<CaptureRecord>('context://captured', (event) => cb(event.payload)),
  onOcrUpdated: (cb: (capture: CaptureRecord) => void): Promise<UnlistenFn> =>
    listen<CaptureRecord>('context://ocr-updated', (event) => cb(event.payload)),
  onChatDelta: (cb: (delta: ChatDelta) => void): Promise<UnlistenFn> =>
    listen<ChatDelta>('chat://delta', (event) => cb(event.payload)),
  onChatFinished: (cb: (finished: ChatFinished) => void): Promise<UnlistenFn> =>
    listen<ChatFinished>('chat://finished', (event) => cb(event.payload)),
  onCaptureStatus: (cb: (status: CaptureStatus) => void): Promise<UnlistenFn> =>
    listen<CaptureStatus>('capture://status', (event) => cb(event.payload)),
  onCaptureRequest: (cb: () => void): Promise<UnlistenFn> =>
    listen('overlay://capture-request', () => cb()),
  onGatewayStatus: (cb: (status: GatewayStatus) => void): Promise<UnlistenFn> =>
    listen<GatewayStatus>('gateway://status', (event) => cb(event.payload)),
  onGatewayInstallProgress: (
    cb: (progress: GatewayInstallProgress) => void,
  ): Promise<UnlistenFn> =>
    listen<GatewayInstallProgress>('gateway://install-progress', (event) =>
      cb(event.payload),
    ),
  onOrbState: (cb: (state: OrbState) => void): Promise<UnlistenFn> =>
    listen<OrbState>('orb://state', (event) => cb(event.payload)),
  onSettingsChanged: (cb: () => void): Promise<UnlistenFn> =>
    listen('settings://changed', () => cb()),
};
