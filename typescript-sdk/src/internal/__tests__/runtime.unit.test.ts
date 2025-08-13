import { describe, it, expect, beforeEach } from 'vitest';
import { detectRuntime, getRuntime, resetRuntimeCache } from '../runtime';

describe('runtime.ts', () => {
  beforeEach(() => {
    // Reset the cached runtime between tests
    resetRuntimeCache();
  });

  describe('detectRuntime', () => {
    it('detects node', () => {
      expect(detectRuntime({ process: { versions: { node: '18.0.0' } } })).toBe('node');
    });
    it('detects deno', () => {
      expect(detectRuntime({ Deno: { version: {} } })).toBe('deno');
    });
    it('detects bun', () => {
      expect(detectRuntime({ Bun: { version: '1.0.0' } })).toBe('bun');
    });
    it('detects web', () => {
      const fakeWindow: any = {};
      fakeWindow.window = fakeWindow;
      fakeWindow.document = {};
      expect(detectRuntime(fakeWindow)).toBe('web');
    });
    it('returns unknown for unrecognized environment', () => {
      expect(detectRuntime({})).toBe('unknown');
    });
    it('returns unknown and does not crash if an error is thrown', () => {
      expect(detectRuntime(new Proxy({}, {
        get() { throw new Error('Simulated error'); }
      }))).toBe('unknown');
    });
  });

  describe('getRuntime', () => {
    it('caches the runtime detection result', () => {
      const firstCall = getRuntime();
      const secondCall = getRuntime();
      expect(firstCall).toBe(secondCall);
    });
  });
});
