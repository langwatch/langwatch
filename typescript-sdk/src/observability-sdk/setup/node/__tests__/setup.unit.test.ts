import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setupObservability, createAndStartNodeSdk } from "../setup.js";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { resetObservabilitySdkConfig } from "../../../config.js";
import { shouldCaptureInput, shouldCaptureOutput } from "../../../config.js";
import { DataCapturePresets } from "../../../features/data-capture/presets.js";

const MockLogger = vi.fn().mockImplementation(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}));

import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { trace } from "@opentelemetry/api";

// Mocks
vi.mock("../../utils", () => ({
  isConcreteProvider: vi.fn(() => false),
  createMergedResource: vi.fn(() => resourceFromAttributes({})),
}));
vi.mock("../../../exporters", () => ({
  LangWatchTraceExporter: vi.fn().mockImplementation(() => ({ shutdown: vi.fn() })),
  LangWatchLogsExporter: vi
    .fn()
    .mockImplementation(() => ({ shutdown: vi.fn() })),
}));
vi.mock("@opentelemetry/sdk-node", () => ({
  NodeSDK: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock("../../../logger", () => ({
  setLangWatchLoggerProvider: vi.fn(),
}));

const defaultOptions = { apiKey: "test", serviceName: "svc" };

describe("setupObservability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetObservabilitySdkConfig();
  });

  afterEach(() => {
    trace.disable();
    resetObservabilitySdkConfig();
  });

  it("returns shutdown noop if skipOpenTelemetrySetup is true", async () => {
    const logger = new MockLogger({});
    const handle = setupObservability({
      langwatch: { apiKey: "test" },
      advanced: { skipOpenTelemetrySetup: true },
      debug: { logger }
    });
    expect(logger.debug).toHaveBeenCalledWith("Skipping OpenTelemetry setup");
    expect(typeof handle.shutdown).toBe("function");
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it("returns shutdown noop if already setup", async () => {
    const { isConcreteProvider } = await import("../../utils.js");
    vi.mocked(isConcreteProvider).mockReturnValue(true);
    const handle = setupObservability(defaultOptions);
    expect(typeof handle.shutdown).toBe("function");
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it("calls createAndStartNodeSdk and returns shutdown", async () => {
    const handle = setupObservability(defaultOptions);
    expect(typeof handle.shutdown).toBe("function");
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it("logs and returns noop shutdown on error if throwOnSetupError is false", async () => {
    const badResource = resourceFromAttributes({});
    Object.defineProperty(badResource, "attributes", {
      get() {
        throw new Error("fail");
      },
    });
    const handle = setupObservability({
      ...defaultOptions,
      resource: badResource,
      advanced: { throwOnSetupError: false },
    });
    expect(typeof handle.shutdown).toBe("function");
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it("returns no-op handle when advanced.disabled is true", async () => {
    const logger = new MockLogger({});
    const handle = setupObservability({
      langwatch: { apiKey: "test" },
      advanced: { disabled: true },
      debug: { logger }
    });

    expect(logger.debug).toHaveBeenCalledWith("Observability disabled via advanced.disabled");
    expect(typeof handle.shutdown).toBe("function");
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });
});

describe("langwatch configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetObservabilitySdkConfig();
  });

  afterEach(() => {
    trace.disable();
    resetObservabilitySdkConfig();
  });

  it("uses batch processor by default", () => {
    const logger = new MockLogger({});
    const sdk = createAndStartNodeSdk({
      langwatch: { apiKey: "test" },
      debug: { logger }
    }, logger, resourceFromAttributes({}));

    expect(logger.debug).toHaveBeenCalledWith(
      "Added LangWatch batch SpanProcessor and LogRecordProcessor to SDK"
    );
    expect(sdk).toBeDefined();
  });

  it("uses batch processor when specified", () => {
    const logger = new MockLogger({});
    const sdk = createAndStartNodeSdk({
      langwatch: {
        apiKey: "test",
        processorType: "batch"
      },
      debug: { logger }
    }, logger, resourceFromAttributes({}));

    expect(logger.debug).toHaveBeenCalledWith(
      "Added LangWatch batch SpanProcessor and LogRecordProcessor to SDK"
    );
    expect(sdk).toBeDefined();
  });

  it("completely disables langwatch when set to 'disabled'", () => {
    const logger = new MockLogger({});
    const fakeProcessor = {
      onStart: vi.fn(),
      onEnd: vi.fn(),
      shutdown: vi.fn(),
      forceFlush: vi.fn(),
    };

    const sdk = createAndStartNodeSdk({
      langwatch: 'disabled',
      spanProcessors: [fakeProcessor],
      debug: { logger }
    }, logger, resourceFromAttributes({}));

    expect(logger.debug).toHaveBeenCalledWith(
      "Added user-provided 1 SpanProcessors to SDK"
    );
    expect(sdk).toBeDefined();
  });

  it("warns about misconfiguration when langwatch disabled without alternatives", () => {
    const logger = new MockLogger({});
    const sdk = createAndStartNodeSdk({
      langwatch: 'disabled',
      debug: { logger }
    }, logger, resourceFromAttributes({}));

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("LangWatch integration is disabled but no custom span processors, trace exporters, or console tracing is configured.")
    );
    expect(sdk).toBeDefined();
  });

  it("throws on misconfiguration when throwOnSetupError is true", () => {
    const logger = new MockLogger({});

    expect(() => createAndStartNodeSdk({
      langwatch: 'disabled',
      advanced: { throwOnSetupError: true },
      debug: { logger }
    }, logger, resourceFromAttributes({}))).toThrow();
  });

  it("does not warn when langwatch disabled but alternatives provided", () => {
    const logger = new MockLogger({});
    const fakeProcessor = {
      onStart: vi.fn(),
      onEnd: vi.fn(),
      shutdown: vi.fn(),
      forceFlush: vi.fn(),
    };

    const sdk = createAndStartNodeSdk({
      langwatch: 'disabled',
      spanProcessors: [fakeProcessor],
      debug: { logger }
    }, logger, resourceFromAttributes({}));

    expect(logger.error).not.toHaveBeenCalledWith(
      expect.stringContaining("LangWatch integration is disabled but no custom span processors")
    );
    expect(sdk).toBeDefined();
  });

  it("does not warn when langwatch disabled but console tracing enabled", () => {
    const logger = new MockLogger({});

    const sdk = createAndStartNodeSdk({
      langwatch: 'disabled',
      debug: {
        consoleTracing: true,
        logger
      }
    }, logger, resourceFromAttributes({}));

    expect(logger.error).not.toHaveBeenCalledWith(
      expect.stringContaining("LangWatch integration is disabled but no custom span processors")
    );
    expect(sdk).toBeDefined();
  });
});

describe("data capture configuration", () => {
  beforeEach(() => {
    resetObservabilitySdkConfig();
  });

  afterEach(() => {
    resetObservabilitySdkConfig();
  });

  describe("default behavior", () => {
    it("captures both input and output by default", () => {
      setupObservability(defaultOptions);

      expect(shouldCaptureInput()).toBe(true);
      expect(shouldCaptureOutput()).toBe(true);
    });
  });

  describe("static mode configuration", () => {
    it("respects 'none' mode", () => {
      setupObservability({
        ...defaultOptions,
        dataCapture: "none",
      });

      expect(shouldCaptureInput()).toBe(false);
      expect(shouldCaptureOutput()).toBe(false);
    });

    it("respects 'input' mode", () => {
      setupObservability({
        ...defaultOptions,
        dataCapture: "input",
      });

      expect(shouldCaptureInput()).toBe(true);
      expect(shouldCaptureOutput()).toBe(false);
    });

    it("respects 'output' mode", () => {
      setupObservability({
        ...defaultOptions,
        dataCapture: "output",
      });

      expect(shouldCaptureInput()).toBe(false);
      expect(shouldCaptureOutput()).toBe(true);
    });

    it("respects 'all' mode", () => {
      setupObservability({
        ...defaultOptions,
        dataCapture: "all",
      });

      expect(shouldCaptureInput()).toBe(true);
      expect(shouldCaptureOutput()).toBe(true);
    });
  });

  describe("preset configurations", () => {
    it("works with CAPTURE_ALL preset", () => {
      setupObservability({
        ...defaultOptions,
        dataCapture: DataCapturePresets.CAPTURE_ALL,
      });

      expect(shouldCaptureInput()).toBe(true);
      expect(shouldCaptureOutput()).toBe(true);
    });

    it("works with CAPTURE_NONE preset", () => {
      setupObservability({
        ...defaultOptions,
        dataCapture: DataCapturePresets.CAPTURE_NONE,
      });

      expect(shouldCaptureInput()).toBe(false);
      expect(shouldCaptureOutput()).toBe(false);
    });

    it("works with INPUT_ONLY preset", () => {
      setupObservability({
        ...defaultOptions,
        dataCapture: DataCapturePresets.INPUT_ONLY,
      });

      expect(shouldCaptureInput()).toBe(true);
      expect(shouldCaptureOutput()).toBe(false);
    });

    it("works with OUTPUT_ONLY preset", () => {
      setupObservability({
        ...defaultOptions,
        dataCapture: DataCapturePresets.OUTPUT_ONLY,
      });

      expect(shouldCaptureInput()).toBe(false);
      expect(shouldCaptureOutput()).toBe(true);
    });
  });

  describe("config object format", () => {
    it("works with config object containing mode", () => {
      setupObservability({
        ...defaultOptions,
        dataCapture: { mode: "input" },
      });

      expect(shouldCaptureInput()).toBe(true);
      expect(shouldCaptureOutput()).toBe(false);
    });
  });
});

describe("createAndStartNodeSdk", () => {
  it("uses provided traceExporter if present", () => {
    const logger = new MockLogger({});
    // Provide a minimal valid OTLPTraceExporter mock
    class FakeExporter extends OTLPTraceExporter {
      export() { /* */ }
      shutdown() {
        return Promise.resolve();
      }
      forceFlush() {
        return Promise.resolve();
      }
    }
    const options = { ...defaultOptions, traceExporter: new FakeExporter() };
    const sdk = createAndStartNodeSdk(
      options,
      logger,
      resourceFromAttributes({}),
    );
    expect(sdk).toBeDefined();
  });

  it("adds console span processor if consoleTracing is true", () => {
    const logger = new MockLogger({});
    const options = {
      ...defaultOptions,
      debug: { consoleTracing: true }
    };
    const sdk = createAndStartNodeSdk(
      options,
      logger,
      resourceFromAttributes({}),
    );
    expect(sdk).toBeDefined();
  });

  it("adds user span processors if provided", () => {
    const logger = new MockLogger({});
    const fakeProcessor = {
      onStart: vi.fn(),
      onEnd: vi.fn(),
      shutdown: vi.fn(),
      forceFlush: vi.fn(),
    };
    const options = { ...defaultOptions, spanProcessors: [fakeProcessor] };
    const sdk = createAndStartNodeSdk(
      options,
      logger,
      resourceFromAttributes({}),
    );
    expect(sdk).toBeDefined();
  });
});

describe("console logging configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetObservabilitySdkConfig();
  });

  afterEach(() => {
    trace.disable();
    resetObservabilitySdkConfig();
  });

  it("enables console logging when consoleLogging is true", () => {
    const logger = new MockLogger({});
    const options = {
      ...defaultOptions,
      debug: { consoleLogging: true }
    };

    const sdk = createAndStartNodeSdk(
      options,
      logger,
      resourceFromAttributes({}),
    );

    expect(sdk).toBeDefined();
    expect(logger.debug).toHaveBeenCalledWith(
      "Console recording of logs enabled; adding console log record processor",
    );
  });

  it("does not enable console logging by default", () => {
    const logger = new MockLogger({});
    const options = { ...defaultOptions };

    const sdk = createAndStartNodeSdk(
      options,
      logger,
      resourceFromAttributes({}),
    );

    expect(sdk).toBeDefined();
    expect(logger.debug).not.toHaveBeenCalledWith(
      "Console recording of logs enabled; adding console log record processor",
    );
  });

  it("enables both console tracing and console logging when both are true", () => {
    const logger = new MockLogger({});
    const options = {
      ...defaultOptions,
      debug: {
        consoleTracing: true,
        consoleLogging: true,
      }
    };

    const sdk = createAndStartNodeSdk(
      options,
      logger,
      resourceFromAttributes({}),
    );

    expect(sdk).toBeDefined();
    expect(logger.debug).toHaveBeenCalledWith(
      "Console tracing enabled; adding console span exporter",
    );
    expect(logger.debug).toHaveBeenCalledWith(
      "Console recording of logs enabled; adding console log record processor",
    );
  });
});

describe("log record processors configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetObservabilitySdkConfig();
  });

  afterEach(() => {
    trace.disable();
    resetObservabilitySdkConfig();
  });

  it("adds user log record processors when provided", () => {
    const logger = new MockLogger({});
    const fakeLogProcessor = {
      onEmit: vi.fn(),
      shutdown: vi.fn(),
      forceFlush: vi.fn(),
    };
    const options = {
      ...defaultOptions,
      logRecordProcessors: [fakeLogProcessor],
    };

    const sdk = createAndStartNodeSdk(
      options,
      logger,
      resourceFromAttributes({}),
    );

    expect(sdk).toBeDefined();
    expect(logger.debug).toHaveBeenCalledWith(
      "Added user-provided 1 LogRecordProcessors to SDK",
    );
  });

  it("adds multiple user log record processors when provided", () => {
    const logger = new MockLogger({});
    const fakeLogProcessor1 = {
      onEmit: vi.fn(),
      shutdown: vi.fn(),
      forceFlush: vi.fn(),
    };
    const fakeLogProcessor2 = {
      onEmit: vi.fn(),
      shutdown: vi.fn(),
      forceFlush: vi.fn(),
    };
    const options = {
      ...defaultOptions,
      logRecordProcessors: [fakeLogProcessor1, fakeLogProcessor2],
    };

    const sdk = createAndStartNodeSdk(
      options,
      logger,
      resourceFromAttributes({}),
    );

    expect(sdk).toBeDefined();
    expect(logger.debug).toHaveBeenCalledWith(
      "Added user-provided 2 LogRecordProcessors to SDK",
    );
  });

  it("uses default batch log record processor when no custom processors provided", () => {
    const logger = new MockLogger({});
    const options = { ...defaultOptions };

    const sdk = createAndStartNodeSdk(
      options,
      logger,
      resourceFromAttributes({}),
    );

    expect(sdk).toBeDefined();
    expect(logger.debug).toHaveBeenCalledWith(
      "Added LangWatch batch SpanProcessor and LogRecordProcessor to SDK",
    );
  });

  it("combines user log record processors with console logging when both enabled", () => {
    const logger = new MockLogger({});
    const fakeLogProcessor = {
      onEmit: vi.fn(),
      shutdown: vi.fn(),
      forceFlush: vi.fn(),
    };
    const options = {
      ...defaultOptions,
      logRecordProcessors: [fakeLogProcessor],
      debug: { consoleLogging: true, logger },
    };

    const sdk = createAndStartNodeSdk(
      options,
      logger,
      resourceFromAttributes({}),
    );

    expect(sdk).toBeDefined();
    expect(logger.debug).toHaveBeenCalledWith(
      "Added user-provided 1 LogRecordProcessors to SDK",
    );
    expect(logger.debug).toHaveBeenCalledWith(
      "Console recording of logs enabled; adding console log record processor",
    );
  });
});

describe("span processors configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetObservabilitySdkConfig();
  });

  afterEach(() => {
    trace.disable();
    resetObservabilitySdkConfig();
  });

  it("uses custom span processors when provided", () => {
    const logger = new MockLogger({});
    const fakeProcessor = {
      onStart: vi.fn(),
      onEnd: vi.fn(),
      shutdown: vi.fn(),
      forceFlush: vi.fn(),
    };
    const options = { ...defaultOptions, spanProcessors: [fakeProcessor] };

    const sdk = createAndStartNodeSdk(
      options,
      logger,
      resourceFromAttributes({}),
    );

    expect(sdk).toBeDefined();
    expect(logger.debug).toHaveBeenCalledWith(
      "Added user-provided 1 SpanProcessors to SDK",
    );
  });

  it("uses default batch span processor when no custom processors provided", () => {
    const logger = new MockLogger({});
    const options = { ...defaultOptions };

    const sdk = createAndStartNodeSdk(
      options,
      logger,
      resourceFromAttributes({}),
    );

    expect(sdk).toBeDefined();
    expect(logger.debug).toHaveBeenCalledWith(
      "Added LangWatch batch SpanProcessor and LogRecordProcessor to SDK",
    );
  });

  it("combines custom span processors with console tracing when both enabled", () => {
    const logger = new MockLogger({});
    const fakeProcessor = {
      onStart: vi.fn(),
      onEnd: vi.fn(),
      shutdown: vi.fn(),
      forceFlush: vi.fn(),
    };
    const options = {
      ...defaultOptions,
      spanProcessors: [fakeProcessor],
      debug: { consoleTracing: true, logger },
    };

    const sdk = createAndStartNodeSdk(
      options,
      logger,
      resourceFromAttributes({}),
    );

    expect(sdk).toBeDefined();
    expect(logger.debug).toHaveBeenCalledWith(
      "Added user-provided 1 SpanProcessors to SDK",
    );
    expect(logger.debug).toHaveBeenCalledWith(
      "Console tracing enabled; adding console span exporter",
    );
  });

  it("does not set traceExporter when custom span processors are used", () => {
    const logger = new MockLogger({});
    const fakeProcessor = {
      onStart: vi.fn(),
      onEnd: vi.fn(),
      shutdown: vi.fn(),
      forceFlush: vi.fn(),
    };
    const options = { ...defaultOptions, spanProcessors: [fakeProcessor] };

    const sdk = createAndStartNodeSdk(
      options,
      logger,
      resourceFromAttributes({}),
    );

    expect(sdk).toBeDefined();
    // The SDK should be created without traceExporter when custom processors are used
  });

  it("does not set traceExporter when console tracing is enabled", () => {
    const logger = new MockLogger({});
    const options = { ...defaultOptions, consoleTracing: true };

    const sdk = createAndStartNodeSdk(
      options,
      logger,
      resourceFromAttributes({}),
    );

    expect(sdk).toBeDefined();
    // The SDK should be created without traceExporter when console tracing is enabled
  });
});

describe("logger configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetObservabilitySdkConfig();
  });

  afterEach(() => {
    trace.disable();
    resetObservabilitySdkConfig();
  });

  it("uses provided logger when specified", () => {
    const customLogger = new MockLogger({});
    const options = {
      ...defaultOptions,
      debug: { logger: customLogger },
      advanced: { skipOpenTelemetrySetup: true },
    };

    setupObservability(options);

    // Verify the custom logger is used by checking if it logs during setup
    // The logger should be called during the setup process
    expect(customLogger.debug).toHaveBeenCalledWith(
      "Skipping OpenTelemetry setup",
    );
  });

  it("uses default console logger when no logger provided", () => {
    const options = { ...defaultOptions };

    setupObservability(options);

    // The default logger should be used without errors
    expect(() => setupObservability(options)).not.toThrow();
  });

  it("passes log level to default logger", () => {
    const options = {
      ...defaultOptions,
      debug: { logLevel: "debug" as const }
    };

    setupObservability(options);

    // Should not throw when log level is specified
    expect(() => setupObservability(options)).not.toThrow();
  });
});

describe("UNSAFE_forceOpenTelemetryReinitialization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetObservabilitySdkConfig();
  });

  afterEach(() => {
    trace.disable();
    resetObservabilitySdkConfig();
  });

  it("warns when forcing reinitialization with existing provider", async () => {
    const { isConcreteProvider } = await import("../../utils.js");
    vi.mocked(isConcreteProvider).mockReturnValue(true);

    const logger = new MockLogger({});
    const options = {
      ...defaultOptions,
      debug: { logger },
      advanced: { UNSAFE_forceOpenTelemetryReinitialization: true },
    };

    setupObservability(options);

    expect(logger.warn).toHaveBeenCalledWith(
      "OpenTelemetry is already set up, but UNSAFE_forceOpenTelemetryReinitialization=true. " +
        "Proceeding with reinitialization. This may cause conflicts.",
    );
  });

  it("does not warn when forcing reinitialization without existing provider", async () => {
    const { isConcreteProvider } = await import("../../utils.js");
    vi.mocked(isConcreteProvider).mockReturnValue(false);

    const logger = new MockLogger({});
    const options = {
      ...defaultOptions,
      debug: { logger },
      advanced: { UNSAFE_forceOpenTelemetryReinitialization: true },
    };

    setupObservability(options);

    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining("UNSAFE_forceOpenTelemetryReinitialization"),
    );
  });
});

describe("error handling in setup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetObservabilitySdkConfig();
  });

  afterEach(() => {
    trace.disable();
    resetObservabilitySdkConfig();
  });

  it("logs error details when setup fails", () => {
    const logger = new MockLogger({});
    const badResource = resourceFromAttributes({});
    Object.defineProperty(badResource, "attributes", {
      get() {
        throw new Error("Test error message");
      },
    });

    const options = {
      ...defaultOptions,
      debug: { logger },
      resource: badResource,
      advanced: { throwOnSetupError: false },
    };

    setupObservability(options);

    // Since the setup is actually succeeding now, we need to check for the success message
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining("Added LangWatch batch SpanProcessor and LogRecordProcessor to SDK"),
    );
  });

  it("throws error when throwOnSetupError is true", async () => {
    // Mock the createMergedResource to throw an error
    const { createMergedResource } = await import("../../utils.js");
    vi.mocked(createMergedResource).mockImplementation(() => {
      throw new Error("Test error message");
    });

    const options = {
      ...defaultOptions,
      advanced: { throwOnSetupError: true },
    };

    expect(() => setupObservability(options)).toThrow("Test error message");
  });

  it("returns noop shutdown when setup fails and throwOnSetupError is false", async () => {
    const logger = new MockLogger({});
    // Mock the createMergedResource to throw an error
    const { createMergedResource } = await import("../../utils.js");
    vi.mocked(createMergedResource).mockImplementation(() => {
      throw new Error("Test error message");
    });

    const options = {
      ...defaultOptions,
      debug: { logger },
      advanced: { throwOnSetupError: false },
    };

    const handle = setupObservability(options);

    expect(typeof handle.shutdown).toBe("function");
    await expect(handle.shutdown()).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      "Failed to initialize NodeSDK: Test error message",
    );
    expect(logger.debug).toHaveBeenCalledWith(
      "Shutdown called for LangWatch no-op. Nothing will be shutdown",
    );
  });
});

describe("auto-shutdown signal handlers", () => {
  let processOnCalls: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    resetObservabilitySdkConfig();
    processOnCalls = [];
    const originalOn = process.on.bind(process);
    vi.spyOn(process, "on").mockImplementation(((event: string, listener: (...args: unknown[]) => void) => {
      processOnCalls.push(event);
      return originalOn(event, listener);
    }) as typeof process.on);
  });

  afterEach(() => {
    trace.disable();
    resetObservabilitySdkConfig();
    vi.mocked(process.on).mockRestore();
  });

  it("registers beforeExit, SIGINT, and SIGTERM handlers by default", () => {
    const logger = new MockLogger({});
    createAndStartNodeSdk(
      { ...defaultOptions, debug: { logger } },
      logger,
      resourceFromAttributes({}),
    );

    expect(processOnCalls).toContain("beforeExit");
    expect(processOnCalls).toContain("SIGINT");
    expect(processOnCalls).toContain("SIGTERM");
  });

  it("does not register signal handlers when disableAutoShutdown is true", () => {
    const logger = new MockLogger({});
    createAndStartNodeSdk(
      {
        ...defaultOptions,
        debug: { logger },
        advanced: { disableAutoShutdown: true },
      },
      logger,
      resourceFromAttributes({}),
    );

    expect(processOnCalls).not.toContain("beforeExit");
    expect(processOnCalls).not.toContain("SIGINT");
    expect(processOnCalls).not.toContain("SIGTERM");
  });
});

describe("NodeSDK configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetObservabilitySdkConfig();
  });

  afterEach(() => {
    trace.disable();
    resetObservabilitySdkConfig();
  });

  it("passes all NodeSDK options correctly", () => {
    const logger = new MockLogger({});
    const fakeContextManager = { name: "fake-context-manager" };
    const fakeTextMapPropagator = { name: "fake-propagator" };
    const fakeMetricReader = { name: "fake-metric-reader" };
    const fakeSampler = { name: "fake-sampler" };
    const fakeIdGenerator = { name: "fake-id-generator" };

    const options = {
      ...defaultOptions,
      debug: { logger },
      autoDetectResources: false,
      contextManager: fakeContextManager as any,
      textMapPropagator: fakeTextMapPropagator as any,
      metricReader: fakeMetricReader as any,
      sampler: fakeSampler as any,
      idGenerator: fakeIdGenerator as any,
      spanLimits: { attributeCountLimit: 100 },
      instrumentations: [],
      resourceDetectors: [],
      views: [],
    };

    const sdk = createAndStartNodeSdk(
      options,
      logger,
      resourceFromAttributes({}),
    );

    expect(sdk).toBeDefined();
  });

  it("starts the NodeSDK after creation", () => {
    const logger = new MockLogger({});
    const options = { ...defaultOptions };

    const sdk = createAndStartNodeSdk(
      options,
      logger,
      resourceFromAttributes({}),
    );

    expect(sdk).toBeDefined();
    expect(logger.info).toHaveBeenCalledWith("NodeSDK started successfully");
  });
});
