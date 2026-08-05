import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { type Logger } from '../../../../logger/index.js';
import {
  initializeObservabilitySdkConfig,
  resetObservabilitySdkConfig,
  getObservabilitySdkLogger,
  shouldCaptureInput,
  shouldCaptureOutput,
} from '../../../config.js';

class MockLogger implements Logger {
  debug = vi.fn();
  info = vi.fn();
  warn = vi.fn();
  error = vi.fn();
}

describe('Data Capture Config', () => {
  let originalConsoleError: any;

  beforeEach(() => {
    resetObservabilitySdkConfig();
    originalConsoleError = console.error;
    console.error = vi.fn();
  });

  afterEach(() => {
    console.error = originalConsoleError;
    resetObservabilitySdkConfig();
  });

  describe('initialization', () => {
    it('initializes config is allowed any number of times', () => {
      const logger = new MockLogger();
      initializeObservabilitySdkConfig({ logger });
      expect(getObservabilitySdkLogger()).toBe(logger);

      // Second call should overwrite
      const logger2 = new MockLogger();
      initializeObservabilitySdkConfig({ logger: logger2 });
      expect(getObservabilitySdkLogger()).toBe(logger2);
    });

    it('returns defaults when config not set', () => {
      // Should fall back to default behavior (capture both)
      expect(shouldCaptureInput()).toBe(true);
      expect(shouldCaptureOutput()).toBe(true);
      // No console.error call expected since the config returns defaults silently
    });

    it('can be reset for testing', () => {
      const logger = new MockLogger();
      initializeObservabilitySdkConfig({ logger });
      expect(getObservabilitySdkLogger()).toBe(logger);

      resetObservabilitySdkConfig();

      // Should be able to initialize again
      const logger2 = new MockLogger();
      initializeObservabilitySdkConfig({ logger: logger2 });
      expect(getObservabilitySdkLogger()).toBe(logger2);
    });
  });

  describe('data capture modes', () => {
    it('respects "none" mode', () => {
      const logger = new MockLogger();
      initializeObservabilitySdkConfig({
        logger,
        dataCapture: "none"
      });

      expect(shouldCaptureInput()).toBe(false);
      expect(shouldCaptureOutput()).toBe(false);
    });

    it('respects "input" mode', () => {
      const logger = new MockLogger();
      initializeObservabilitySdkConfig({
        logger,
        dataCapture: "input"
      });

      expect(shouldCaptureInput()).toBe(true);
      expect(shouldCaptureOutput()).toBe(false);
    });

    it('respects "output" mode', () => {
      const logger = new MockLogger();
      initializeObservabilitySdkConfig({
        logger,
        dataCapture: "output"
      });

      expect(shouldCaptureInput()).toBe(false);
      expect(shouldCaptureOutput()).toBe(true);
    });

    it('respects "all" mode', () => {
      const logger = new MockLogger();
      initializeObservabilitySdkConfig({
        logger,
        dataCapture: "all"
      });

      expect(shouldCaptureInput()).toBe(true);
      expect(shouldCaptureOutput()).toBe(true);
    });

    it('defaults to "all" mode when dataCapture not specified', () => {
      const logger = new MockLogger();
      initializeObservabilitySdkConfig({ logger });

      expect(shouldCaptureInput()).toBe(true);
      expect(shouldCaptureOutput()).toBe(true);
    });
  });
});
