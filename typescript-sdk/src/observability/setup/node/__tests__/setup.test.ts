import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setupObservability, createAndStartNodeSdk } from "../setup";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  resetObservabilitySdkConfig
} from "../../../config.js";
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

// Helper to create a mock logger
function createMockLogger() {
  return { error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
}

// Mocks
vi.mock("../../utils", () => ({
  isConcreteProvider: vi.fn(() => false),
}));
vi.mock("../../../exporters", () => ({
  LangWatchExporter: vi.fn().mockImplementation(() => ({ shutdown: vi.fn() })),
}));
vi.mock("@opentelemetry/sdk-node", () => ({
  NodeSDK: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  })),
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
    const handle = setupObservability({
      ...defaultOptions,
      skipOpenTelemetrySetup: true,
    });
    expect(typeof handle.shutdown).toBe("function");
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it("returns shutdown noop if already setup", async () => {
    const { isConcreteProvider } = await import("../../utils.ts");
    (isConcreteProvider as any).mockReturnValue(true);
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
      throwOnSetupError: false,
    });
    expect(typeof handle.shutdown).toBe("function");
    await expect(handle.shutdown()).resolves.toBeUndefined();
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
        dataCapture: "none"
      });

      expect(shouldCaptureInput()).toBe(false);
      expect(shouldCaptureOutput()).toBe(false);
    });

    it("respects 'input' mode", () => {
      setupObservability({
        ...defaultOptions,
        dataCapture: "input"
      });

      expect(shouldCaptureInput()).toBe(true);
      expect(shouldCaptureOutput()).toBe(false);
    });

    it("respects 'output' mode", () => {
      setupObservability({
        ...defaultOptions,
        dataCapture: "output"
      });

      expect(shouldCaptureInput()).toBe(false);
      expect(shouldCaptureOutput()).toBe(true);
    });

    it("respects 'all' mode", () => {
      setupObservability({
        ...defaultOptions,
        dataCapture: "all"
      });

      expect(shouldCaptureInput()).toBe(true);
      expect(shouldCaptureOutput()).toBe(true);
    });
  });

  describe("preset configurations", () => {
    it("works with CAPTURE_ALL preset", () => {
      setupObservability({
        ...defaultOptions,
        dataCapture: DataCapturePresets.CAPTURE_ALL
      });

      expect(shouldCaptureInput()).toBe(true);
      expect(shouldCaptureOutput()).toBe(true);
    });

    it("works with CAPTURE_NONE preset", () => {
      setupObservability({
        ...defaultOptions,
        dataCapture: DataCapturePresets.CAPTURE_NONE
      });

      expect(shouldCaptureInput()).toBe(false);
      expect(shouldCaptureOutput()).toBe(false);
    });

    it("works with INPUT_ONLY preset", () => {
      setupObservability({
        ...defaultOptions,
        dataCapture: DataCapturePresets.INPUT_ONLY
      });

      expect(shouldCaptureInput()).toBe(true);
      expect(shouldCaptureOutput()).toBe(false);
    });

    it("works with OUTPUT_ONLY preset", () => {
      setupObservability({
        ...defaultOptions,
        dataCapture: DataCapturePresets.OUTPUT_ONLY
      });

      expect(shouldCaptureInput()).toBe(false);
      expect(shouldCaptureOutput()).toBe(true);
    });
  });

  describe("predicate function configuration", () => {
    it("calls predicate function with context for dynamic decisions", () => {
      const mockPredicate = vi.fn().mockReturnValue("all");

      setupObservability({
        ...defaultOptions,
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

    it("respects predicate function return values", () => {
      setupObservability({
        ...defaultOptions,
        dataCapture: (ctx) => {
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

    it("falls back to 'all' when no context provided to predicate", () => {
      setupObservability({
        ...defaultOptions,
        dataCapture: () => "input" // Would normally return input only
      });

      // Without context, should fall back to default
      expect(shouldCaptureInput()).toBe(true);
      expect(shouldCaptureOutput()).toBe(true);
    });
  });

  describe("config object format", () => {
    it("works with config object containing mode", () => {
      setupObservability({
        ...defaultOptions,
        dataCapture: { mode: "input" }
      });

      expect(shouldCaptureInput()).toBe(true);
      expect(shouldCaptureOutput()).toBe(false);
    });
  });

  describe("context parameter handling", () => {
    it("provides default values for missing context properties", () => {
      const mockPredicate = vi.fn().mockReturnValue("all");

      setupObservability({
        ...defaultOptions,
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

    it("preserves provided context properties", () => {
      const mockPredicate = vi.fn().mockReturnValue("all");

      setupObservability({
        ...defaultOptions,
        dataCapture: mockPredicate
      });

      const fullContext = {
        spanType: "llm",
        operationName: "chat_completion",
        spanAttributes: { model: "gpt-4" },
        environment: "production"
      };

      shouldCaptureInput(fullContext);

      expect(mockPredicate).toHaveBeenCalledWith(fullContext);
    });
  });
});

describe("createAndStartNodeSdk", () => {
  it("uses provided traceExporter if present", () => {
    const logger = new MockLogger({});
    // Provide a minimal valid OTLPTraceExporter mock
    class FakeExporter extends OTLPTraceExporter {
      export() {}
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
    const options = { ...defaultOptions, consoleTracing: true };
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

