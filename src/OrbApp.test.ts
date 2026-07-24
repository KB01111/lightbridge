import { describe, expect, it } from 'vitest';
import { DOT_VARIANT, matchesActivity } from './OrbApp';

describe('status orb visual state', () => {
  it('uses distinct accessible variants for ready, setup, and failure', () => {
    expect(DOT_VARIANT.ready).toBe('success');
    expect(DOT_VARIANT.setupRequired).toBe('warning');
    expect(DOT_VARIANT.offline).toBe('error');
  });

  it('pulses only for active capture and generation work', () => {
    expect(matchesActivity('capturing')).toBe(true);
    expect(matchesActivity('generating')).toBe(true);
    expect(matchesActivity('ready')).toBe(false);
    expect(matchesActivity('paused')).toBe(false);
  });
});
