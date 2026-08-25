import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { type Logger } from "../../logger";

class MockLogger implements Logger {
  debug = vi.fn();
  info = vi.fn();
  warn = vi.fn();
  error = vi.fn();
}

describe("config.ts", () => {
  let originalConsoleError: any;
  beforeEach(() => {
    vi.resetModules();
    originalConsoleError = console.error;
    console.error = vi.fn();
  });
  afterEach(() => {
    console.error = originalConsoleError;
    vi.unstubAllEnvs();
  });

  it("initializeObservabilitySdkConfig sets config any number of times", async () => {
    const config = await import("../config.js");
    config.resetObservabilitySdkConfig(); // Ensure clean state

    const logger = new MockLogger();
    config.initializeObservabilitySdkConfig({ logger });
    expect(config.getObservabilitySdkLogger()).toBe(logger);

    // Second call should overwrite
    const logger2 = new MockLogger();
    config.initializeObservabilitySdkConfig({ logger: logger2 });
    expect(config.getObservabilitySdkLogger()).toBe(logger2);
  });

  it("getObservabilitySdkLogger works after config is set", async () => {
    const config = await import("../config.js");
    config.resetObservabilitySdkConfig(); // Ensure clean state

    const logger = new MockLogger();
    config.initializeObservabilitySdkConfig({ logger });
    expect(config.getObservabilitySdkLogger()).toBe(logger);
  });

  it("getObservabilitySdkConfig throws error when not initialized and throwOnUninitialized is true", async () => {
    const config = await import("../config.js");
    config.resetObservabilitySdkConfig(); // Ensure clean state

    expect(() => {
      config.getObservabilitySdkConfig({ throwOnUninitialized: true });
    }).toThrow("Please call setupObservability() before using the Observability SDK");
  });

  it("getObservabilitySdkConfig returns default when not initialized and throwOnUninitialized is false", async () => {
    const config = await import("../config.js");
    config.resetObservabilitySdkConfig(); // Ensure clean state

    const result = config.getObservabilitySdkConfig({ throwOnUninitialized: false });
    expect(result.logger).toBeInstanceOf(
      (await import("../../logger/index.js")).NoOpLogger,
    );
  });

  it("getObservabilitySdkConfig returns actual config when initialized", async () => {
    const config = await import("../config.js");
    config.resetObservabilitySdkConfig(); // Ensure clean state

    const logger = new MockLogger();
    config.initializeObservabilitySdkConfig({ logger });

    const result = config.getObservabilitySdkConfig();
    expect(result.logger).toBe(logger);
  });

  describe("when NODE_ENV is development and the SDK is not initialized", () => {
    beforeEach(() => {
      vi.stubEnv("NODE_ENV", "development");
    });

    it("getObservabilitySdkConfig with no options still throws", async () => {
      const config = await import("../config.js");
      config.resetObservabilitySdkConfig();

      expect(() => {
        config.getObservabilitySdkConfig();
      }).toThrow("Please call setupObservability() before using the Observability SDK");
    });

    it("an explicit throwOnUninitialized: false wins over development mode", async () => {
      const config = await import("../config.js");
      config.resetObservabilitySdkConfig();

      const result = config.getObservabilitySdkConfig({ throwOnUninitialized: false });
      expect(result.logger).toBeInstanceOf(
        (await import("../../logger/index.js")).NoOpLogger,
      );
    });

    // Regression: `langwatch prompt push` crashed with "Please call
    // setupObservability()" whenever NODE_ENV=development, because the prompt
    // tracing decorators ask shouldCaptureInput() on every call. Passive
    // capture reads must degrade to the defaults, never throw.
    it('getDataCaptureMode falls back to "all" instead of throwing', async () => {
      const config = await import("../config.js");
      config.resetObservabilitySdkConfig();

      expect(config.getDataCaptureMode()).toBe("all");
    });

    it("shouldCaptureInput and shouldCaptureOutput answer instead of throwing", async () => {
      const config = await import("../config.js");
      config.resetObservabilitySdkConfig();

      expect(config.shouldCaptureInput()).toBe(true);
      expect(config.shouldCaptureOutput()).toBe(true);
    });
  });
});
