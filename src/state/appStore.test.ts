import { describe, expect, it } from 'vitest';
import { contextFromCapture, estimateTokens } from './appStore';
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
  it('returns at least 1', () => {
    expect(estimateTokens('')).toBe(1);
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
  });
});
