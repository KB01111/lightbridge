import { describe, expect, it } from 'vitest';
import {
  contextFromCapture,
  estimateTokens,
  selectionsFromContext,
  useAppStore,
} from './appStore';
import type { CaptureRecord } from '../lib/ipc';

const sample: CaptureRecord = {
  id: 'c1',
  window: {
    hwnd: 1,
    processId: 2,
    processPath: 'C:\\App\\demo.exe',
    appName: 'demo',
    title: 'Hello',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    dpi: 96,
    monitor: '100x100',
  },
  imagePath: 'x.png',
  previewBase64: 'data:image/jpeg;base64,xx',
  contentHash: 'abc',
  ocrText: 'Visible text on screen',
  ocrStatus: 'done',
  createdAt: new Date().toISOString(),
};

describe('estimateTokens', () => {
  it('does not show a phantom token for empty input', () => {
    expect(estimateTokens('')).toBe(0);
  });
});

describe('contextFromCapture', () => {
  it('includes window, screenshot, and ocr items', () => {
    const items = contextFromCapture(sample);
    expect(items.map((i) => i.sourceType)).toEqual([
      'window',
      'screenshot',
      'ocr',
    ]);
    expect(items.every((i) => i.included)).toBe(true);
    expect(items.every((i) => i.captureId === sample.id)).toBe(true);
    expect(
      items.every((i) => !Object.hasOwn(i, 'content')),
    ).toBe(true);
  });

  it('creates opaque backend selections without image paths or OCR text', () => {
    const selections = selectionsFromContext(contextFromCapture(sample));
    expect(selections).toEqual([
      { captureId: 'c1', kind: 'window' },
      { captureId: 'c1', kind: 'screenshot' },
      { captureId: 'c1', kind: 'ocr' },
    ]);
    expect(JSON.stringify(selections)).not.toContain('x.png');
    expect(JSON.stringify(selections)).not.toContain('Visible text');
  });
});

describe('stream state', () => {
  it('treats cancellation as a terminal non-error state', () => {
    useAppStore.getState().startStream('stream-1');
    useAppStore.getState().appendDelta('partial');
    useAppStore.getState().finishStream('cancelled', null);
    expect(useAppStore.getState().streamState).toBe('idle');
    expect(useAppStore.getState().streamError).toBeNull();
    expect(useAppStore.getState().streamId).toBeNull();
  });
});
