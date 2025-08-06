import { describe, it, expect } from 'vitest';
import * as constants from '../constants';
import { detectRuntime } from '../constants';

describe('constants.ts', () => {
  it('exports correct constant values', () => {
    expect(constants.LANGWATCH_SDK_NAME).toBe('langwatch-observability-sdk');
    expect(constants.LANGWATCH_SDK_LANGUAGE).toBe('typescript');
    expect(typeof constants.LANGWATCH_SDK_VERSION).toBe('string');
    expect(constants.DEFAULT_ENDPOINT).toBe('https://app.langwatch.ai/');
    expect(constants.DEFAULT_SERVICE_NAME).toBe('langwatch-observed-service');
    expect(constants.TRACES_PATH).toBe('/api/otel/v1/traces');
    expect(constants.LOGS_PATH).toBe('/api/otel/v1/logs');
    expect(constants.METRICS_PATH).toBe('/api/otel/v1/metrics');
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
});
