import { useEffect, useState, type CSSProperties } from 'react';
import { useTheme } from '@astryxdesign/core/theme';

import { useSystemPreference } from './useSystemPreferences';

export type EntryPreset = 'fadeIn' | 'slideUp' | 'slideDown' | 'scaleIn';

const HIDDEN: Record<EntryPreset, CSSProperties> = {
  fadeIn: { opacity: 0 },
  slideUp: { opacity: 0, transform: 'translateY(var(--spacing-2))' },
  slideDown: { opacity: 0, transform: 'translateY(calc(var(--spacing-2) * -1))' },
  scaleIn: { opacity: 0, transform: 'scale(0.97)' },
};

const VISIBLE: CSSProperties = { opacity: 1, transform: 'none' };

// `main.tsx` swaps to this theme whenever the app's own
// `appearance.reducedMotion` setting is on (see theme.ts). Checking the
// active theme's name lets this hook honor that setting the same way
// OrbApp's StatusDot pulse checks it directly against the settings query,
// without this generic hook needing to know about ipc/settings shapes.
const REDUCED_MOTION_THEME = 'graphite-aurora-reduced-motion';

/**
 * Returns a style object that animates an element in — on mount by default,
 * or whenever `active` flips from false to true — using the Astryx motion
 * tokens. Replaces `useEntryAnimation`, which requires a StyleX runtime this
 * project does not ship.
 *
 * Pass `active` for elements that stay mounted and only toggle visibility
 * (e.g. a dialog's content, which persists across opens so its internal
 * state survives); leave it at the default for elements that genuinely
 * mount fresh each time they appear (e.g. a banner or chat message rendered
 * behind a `condition && <X />` guard).
 *
 * Honors reduced motion from both the OS (`prefers-reduced-motion`) and the
 * app's own Appearance setting.
 */
export function useEntryTransition(
  preset: EntryPreset = 'fadeIn',
  duration: '--duration-fast' | '--duration-medium' = '--duration-medium',
  active = true,
): CSSProperties {
  const systemReducedMotion = useSystemPreference(
    '(prefers-reduced-motion: reduce)',
  );
  const { name: themeName } = useTheme();
  const reducedMotion =
    systemReducedMotion || themeName === REDUCED_MOTION_THEME;
  const [entered, setEntered] = useState(() => !active || reducedMotion);

  useEffect(() => {
    if (!active || reducedMotion) {
      setEntered(true);
      return;
    }
    setEntered(false);
    // Double rAF ensures the hidden state paints before transitioning.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setEntered(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [active, reducedMotion]);

  return {
    ...(entered ? VISIBLE : HIDDEN[preset]),
    transitionProperty: 'opacity, transform',
    transitionDuration: `var(${duration})`,
    transitionTimingFunction: 'var(--ease-standard)',
  };
}
