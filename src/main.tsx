import { lazy, StrictMode, Suspense, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Theme } from '@astryxdesign/core';

import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';

import { ipc } from './lib/ipc';
import { useSystemPreference } from './lib/useSystemPreferences';
import {
  graphiteAuroraReducedMotionTheme,
  graphiteAuroraTheme,
} from './theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5_000,
      refetchOnWindowFocus: false,
    },
  },
});
const OverlayApp = lazy(() => import('./App'));
const OrbApp = lazy(() => import('./OrbApp'));
const SettingsApp = lazy(() => import('./SettingsApp'));

document.documentElement.style.background = 'transparent';
document.documentElement.style.width = '100%';
document.documentElement.style.height = '100%';
document.body.style.background = 'transparent';
document.body.style.width = '100%';
document.body.style.height = '100%';
document.body.style.margin = '0';
document.body.style.overflow = 'hidden';
const rootElement = document.getElementById('root')!;
rootElement.style.width = '100%';
rootElement.style.height = '100%';

const isTauri = '__TAURI_INTERNALS__' in window;
const surface = isTauri ? getCurrentWindow().label : 'main';
document.documentElement.dataset.surface = surface;

function ThemedSurface() {
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: ipc.getSettings,
    enabled: isTauri,
  });
  const mode = settingsQuery.data?.appearance.mode ?? 'dark';
  const forcedColors = useSystemPreference('(forced-colors: active)');
  useEffect(() => {
    const opacity = forcedColors
      ? 100
      : (settingsQuery.data?.overlay.opacity ?? 88);
    document.documentElement.style.setProperty(
      '--lightbridge-panel-opacity',
      `${opacity}%`,
    );
  }, [forcedColors, settingsQuery.data?.overlay.opacity]);
  const theme = settingsQuery.data?.appearance.reducedMotion
    ? graphiteAuroraReducedMotionTheme
    : graphiteAuroraTheme;
  const content =
    surface === 'orb' ? (
      <OrbApp />
    ) : surface === 'settings' ? (
      <SettingsApp />
    ) : (
      <OverlayApp />
    );
  return (
    <Theme theme={theme} mode={mode}>
      <Suspense fallback={null}>{content}</Suspense>
    </Theme>
  );
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemedSurface />
    </QueryClientProvider>
  </StrictMode>,
);
