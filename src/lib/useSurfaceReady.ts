import { useEffect } from 'react';
import { ipc } from './ipc';

export function useSurfaceReady(surface: string, stateReady = true) {
  useEffect(() => {
    if (!stateReady) return;
    let cancelled = false;
    const signal = async () => {
      try {
        await document.fonts?.ready;
      } catch {
        // System fonts are still usable if the FontFaceSet is unavailable.
      }
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => resolve()),
        ),
      );
      if (!cancelled) {
        await ipc.readyToShow(surface);
      }
    };
    void signal();
    return () => {
      cancelled = true;
    };
  }, [stateReady, surface]);
}
