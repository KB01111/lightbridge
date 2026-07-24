import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getCurrentWindow } from '@tauri-apps/api/window';

import { AppShell } from '@astryxdesign/core/AppShell';
import { Center } from '@astryxdesign/core/Center';
import { Button } from '@astryxdesign/core/Button';
import { StatusDot } from '@astryxdesign/core/StatusDot';

import { events, ipc, type OrbPhase, type OrbState } from './lib/ipc';
import { useSurfaceReady } from './lib/useSurfaceReady';
import { useSystemPreference } from './lib/useSystemPreferences';

export const DOT_VARIANT: Record<
  OrbPhase,
  'success' | 'accent' | 'warning' | 'neutral' | 'error'
> = {
  ready: 'success',
  capturing: 'warning',
  generating: 'accent',
  paused: 'neutral',
  setupRequired: 'warning',
  offline: 'error',
  error: 'error',
};

const DEFAULT_STATE: OrbState = {
  phase: 'setupRequired',
  label: 'Setup required',
  detail: 'Connect a provider in Settings.',
};

export default function OrbApp() {
  const queryClient = useQueryClient();
  const stateQuery = useQuery({
    queryKey: ['orbState'],
    queryFn: ipc.getOrbState,
    refetchInterval: 15_000,
  });
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: ipc.getSettings,
  });
  useSurfaceReady('orb', stateQuery.isFetched && settingsQuery.isFetched);
  const systemReducedMotion = useSystemPreference(
    '(prefers-reduced-motion: reduce)',
  );
  const [liveState, setLiveState] = useState<OrbState | null>(null);
  const pointer = useRef({ x: 0, y: 0, dragging: false });
  const snapTimer = useRef<number | null>(null);

  useEffect(() => {
    const unlistenState = events.onOrbState(setLiveState);
    const unlistenSettings = events.onSettingsChanged(() => {
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
      void queryClient.invalidateQueries({ queryKey: ['orbState'] });
    });
    const windowHandle = getCurrentWindow();
    const unlistenMove = windowHandle.onMoved(() => {
      if (snapTimer.current != null) window.clearTimeout(snapTimer.current);
      snapTimer.current = window.setTimeout(() => {
        void ipc.snapOrb();
      }, 220);
    });
    return () => {
      void unlistenState.then((unlisten) => unlisten());
      void unlistenSettings.then((unlisten) => unlisten());
      void unlistenMove.then((unlisten) => unlisten());
      if (snapTimer.current != null) window.clearTimeout(snapTimer.current);
    };
  }, [queryClient]);

  const orbState = liveState ?? stateQuery.data ?? DEFAULT_STATE;

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    pointer.current = {
      x: event.clientX,
      y: event.clientY,
      dragging: false,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if ((event.buttons & 1) === 0 || pointer.current.dragging) return;
    const distance = Math.hypot(
      event.clientX - pointer.current.x,
      event.clientY - pointer.current.y,
    );
    if (distance > 3) {
      pointer.current.dragging = true;
      void getCurrentWindow().startDragging();
    }
  };

  const onPointerUp = () => {
    if (!pointer.current.dragging) void ipc.toggleOverlay();
    pointer.current.dragging = false;
  };

  return (
    <AppShell height="fill" variant="wash" contentPadding={0}>
      <Center
        style={{ width: '100%', height: '100%' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onContextMenu={(event) => {
          event.preventDefault();
          void ipc.showOrbMenu();
        }}>
        <Button
          label={`${orbState.label}. ${orbState.detail}`}
          variant="secondary"
          isIconOnly
          icon={
            <StatusDot
              variant={DOT_VARIANT[orbState.phase]}
              label={orbState.label}
              isPulsing={
                matchesActivity(orbState.phase) &&
                !systemReducedMotion &&
                settingsQuery.data?.appearance.reducedMotion !== true
              }
            />
          }
          style={{
            width: '100%',
            height: '100%',
            minWidth: 0,
            padding: 0,
            borderRadius: 'var(--radius-full)',
            boxShadow: 'var(--shadow-lg)',
          }}
          onClick={(event) => event.preventDefault()}
        />
      </Center>
    </AppShell>
  );
}

export function matchesActivity(phase: OrbPhase) {
  return phase === 'capturing' || phase === 'generating';
}
