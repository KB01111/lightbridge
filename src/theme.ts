import { defineTheme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral';

export const graphiteAuroraTheme = defineTheme({
  name: 'graphite-aurora',
  extends: neutralTheme,
  // `color.accent` seeds every accent-derived token that the explicit
  // `--color-accent` override below does NOT already replace (on-accent,
  // accent-muted, icon-*, overlay-*, border-emphasized, skeleton, track,
  // shadow, neutral). It must match the light-mode value of that override
  // below — otherwise those derived tokens are generated from a seed that
  // is never actually rendered, producing a subtly mismatched purple.
  color: {
    accent: '#635BFF',
    neutralStyle: 'cool',
    contrast: 'standard',
  },
  typography: {
    scale: { base: 14, ratio: 1.18 },
    body: {
      family: 'Segoe UI Variable',
      fallbacks: 'Segoe UI, system-ui, sans-serif',
    },
    heading: {
      family: 'Segoe UI Variable Display',
      fallbacks: 'Segoe UI, system-ui, sans-serif',
    },
    code: {
      family: 'Cascadia Code',
      fallbacks: 'Consolas, monospace',
    },
  },
  radius: { base: 10, multiplier: 1.2 },
  motion: {
    fast: 150,
    medium: 320,
    ratio: 0.72,
    easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  },
  tokens: {
    '--color-accent': ['#635BFF', '#908AFF'],
    '--color-background-body': ['#F3F4FA', '#090B12'],
    '--color-background-surface': ['#FCFCFF', '#11141F'],
    '--color-background-muted': ['#F0F1F8', '#171A27'],
    '--color-background-card': ['#FFFFFF', '#1C2030'],
    '--color-border': ['#DADCE8', '#2B3043'],
    '--color-text-primary': ['#171926', '#F4F5FF'],
    '--color-text-secondary': ['#65697C', '#A8ADC2'],
  },
  components: {
    'app-shell': {
      base: {
        width: '100%',
        maxWidth: 'none',
        height: '100%',
        borderRadius: 'var(--radius-page)',
        overflow: 'hidden',
        borderColor: 'var(--color-border)',
        borderStyle: 'solid',
        borderWidth: 'var(--border-width-thin)',
        backgroundColor:
          'color-mix(in srgb, var(--color-background-surface) var(--lightbridge-panel-opacity), transparent)',
        backdropFilter: 'blur(var(--spacing-6))',
      },
      'variant:wash': {
        backgroundColor: 'transparent',
        borderColor: 'transparent',
      },
    },
    toolbar: {
      base: {
        backgroundColor:
          'color-mix(in srgb, var(--color-background-muted) 78%, transparent)',
      },
    },
    'side-nav': {
      base: {
        backgroundColor:
          'color-mix(in srgb, var(--color-background-muted) 82%, transparent)',
      },
    },
    dialog: {
      base: {
        backgroundColor:
          'color-mix(in srgb, var(--color-background-card) 94%, transparent)',
      },
    },
  },
});

export const REDUCED_MOTION_THEME_NAME = 'graphite-aurora-reduced-motion';

export const graphiteAuroraReducedMotionTheme = defineTheme({
  name: REDUCED_MOTION_THEME_NAME,
  extends: graphiteAuroraTheme,
  motion: {
    fast: 1,
    medium: 1,
    ratio: 1,
    easing: 'linear',
  },
});
