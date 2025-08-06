import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Logger } from '../../../../logger';
import {
  initializeObservabilitySdkConfig,
  resetObservabilitySdkConfig,
  getObservabilitySdkLogger,
  shouldCaptureInput,
  shouldCaptureOutput,
} from '../../../config.js';
import { DataCaptureContext } from '../types.js';

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
    it('initializes config only once', () => {
      const logger = new MockLogger();
      initializeObservabilitySdkConfig({ logger });
      expect(getObservabilitySdkLogger()).toBe(logger);

      // Second call should log error and not overwrite
      const logger2 = new MockLogger();
      initializeObservabilitySdkConfig({ logger: logger2 });
      expect(getObservabilitySdkLogger()).toBe(logger);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('already initialized')
      );
    });

    it('returns defaults when config not set', () => {
      // Should fall back to default behavior (capture both)
      expect(shouldCaptureInput()).toBe(true);
      expect(shouldCaptureOutput()).toBe(true);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Please call setupObservability')
      );
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

  describe('predicate functions', () => {
    it('calls predicate function with proper context', () => {
      const mockPredicate = vi.fn().mockReturnValue("input");
      const logger = new MockLogger();
      initializeObservabilitySdkConfig({
        logger,
        dataCapture: mockPredicate
      });

      const context = {
        spanType: "llm",
        operationName: "chat_completion",
        spanAttributes: { model: "gpt-4" }
      };

      shouldCaptureInput(context);

      expect(mockPredicate).toHaveBeenCalledWith({
        spanType: "llm",
        operationName: "chat_completion",
        spanAttributes: { model: "gpt-4" },
        environment: undefined
      });
    });

    it('respects predicate function return values', () => {
      const logger = new MockLogger();
      initializeObservabilitySdkConfig({
        logger,
        dataCapture: (ctx: DataCaptureContext) => {
          if (ctx.spanType === "llm") return "all";
          if (ctx.spanType === "tool") return "input";
          return "none";
        }
      });

      // LLM spans should capture both
      expect(shouldCaptureInput({ spanType: "llm" })).toBe(true);
      expect(shouldCaptureOutput({ spanType: "llm" })).toBe(true);

      // Tool spans should capture input only
      expect(shouldCaptureInput({ spanType: "tool" })).toBe(true);
      expect(shouldCaptureOutput({ spanType: "tool" })).toBe(false);

      // Other spans should capture nothing
      expect(shouldCaptureInput({ spanType: "chain" })).toBe(false);
      expect(shouldCaptureOutput({ spanType: "chain" })).toBe(false);
    });

    it('falls back to "all" when no context provided to predicate', () => {
      const logger = new MockLogger();
      initializeObservabilitySdkConfig({
        logger,
        dataCapture: () => "input" // Would normally return input only
      });

      // Without context, should fall back to default
      expect(shouldCaptureInput()).toBe(true);
      expect(shouldCaptureOutput()).toBe(true);
    });

    it('provides default values for missing context properties', () => {
      const mockPredicate = vi.fn().mockReturnValue("all");
      const logger = new MockLogger();
      initializeObservabilitySdkConfig({
        logger,
        dataCapture: mockPredicate
      });

      shouldCaptureInput({ spanType: "llm" }); // Partial context

      expect(mockPredicate).toHaveBeenCalledWith({
        spanType: "llm",
        operationName: "unknown",
        spanAttributes: {},
        environment: undefined
      });
    });
  });

  describe('config object format', () => {
    it('works with config object containing mode', () => {
      const logger = new MockLogger();
      initializeObservabilitySdkConfig({
        logger,
        dataCapture: { mode: "input" }
      });

      expect(shouldCaptureInput()).toBe(true);
      expect(shouldCaptureOutput()).toBe(false);
    });

    it('falls back to default when config object has no mode', () => {
      const logger = new MockLogger();
      initializeObservabilitySdkConfig({
        logger,
        dataCapture: {} as any
      });

      expect(shouldCaptureInput()).toBe(true);
      expect(shouldCaptureOutput()).toBe(true);
    });
  });
});
