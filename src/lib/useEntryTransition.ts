import { useEffect, useState, type CSSProperties } from 'react';

type EntryPreset = 'fadeIn' | 'slideUp' | 'slideDown' | 'scaleIn';

const HIDDEN: Record<EntryPreset, CSSProperties> = {
  fadeIn: { opacity: 0 },
  slideUp: { opacity: 0, transform: 'translateY(var(--spacing-2))' },
  slideDown: { opacity: 0, transform: 'translateY(calc(var(--spacing-2) * -1))' },
  scaleIn: { opacity: 0, transform: 'scale(0.97)' },
};

const VISIBLE: CSSProperties = { opacity: 1, transform: 'none' };

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Returns a style object that animates an element in on mount using the
 * Astryx motion tokens. Replace-for `useEntryAnimation`, which requires a
 * StyleX runtime this project does not ship. Honors reduced-motion.
 */
export function useEntryTransition(
  preset: EntryPreset = 'fadeIn',
  duration: '--duration-fast' | '--duration-medium' = '--duration-medium',
): CSSProperties {
  const [entered, setEntered] = useState(() => prefersReducedMotion());

  useEffect(() => {
    if (entered) return;
    // Double rAF ensures the hidden state paints before transitioning.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setEntered(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [entered]);

  return {
    ...(entered ? VISIBLE : HIDDEN[preset]),
    transitionProperty: 'opacity, transform',
    transitionDuration: `var(${duration})`,
    transitionTimingFunction: 'var(--ease-standard)',
  };
}
