import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setupObservability = vi.fn((_options: Record<string, unknown>) => ({
  shutdown: () => Promise.resolve(),
}));

vi.mock("langwatch/observability/node", () => ({
  setupObservability: (options: Record<string, unknown>) => setupObservability(options),
}));

vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({}),
}));

import { createProcessObservability } from "../process-observability.ts";
import { processTelemetry } from "../process-telemetry.ts";
import type { TelemetrySecret, TelemetrySettings } from "../telemetry-settings.ts";
import { UnexportedSpanProcessor } from "../unexported-spans.ts";

/** What the SDK was actually handed, for the one call this test made. */
function sdkOptions(): {
  spanProcessors?: readonly unknown[];
  advanced?: Record<string, unknown>;
  sampler?: unknown;
  langwatch?: unknown;
} {
  expect(setupObservability).toHaveBeenCalledTimes(1);
  return setupObservability.mock.calls[0]?.[0] as never;
}

beforeEach(() => {
  setupObservability.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("given a process configured with no LangWatch credentials", () => {
  describe("when it composes its observability", () => {
    /** @scenario "A process with nowhere to send traces records them anyway and says nothing" */
    it("keeps OpenTelemetry on and says where the spans go", () => {
      createProcessObservability({
        serviceName: "langwatch-api",
        setup: { langwatch: "disabled" },
      });

      const options = sdkOptions();

      // Not `advanced.disabled`: that returns a no-op handle and registers no
      // provider, so every log line loses the trace id that groups a request's
      // lines together in a five-lane terminal.
      expect(options.advanced?.disabled).toBeUndefined();
      expect(options.advanced?.skipOpenTelemetrySetup).toBeUndefined();
      expect(options.spanProcessors).toHaveLength(1);
      expect(options.spanProcessors?.[0]).toBeInstanceOf(UnexportedSpanProcessor);
    });
  });
});

describe("given a process configured with a LangWatch API key", () => {
  describe("when it composes its observability", () => {
    /** @scenario "A process with somewhere to send traces is left alone" */
    it("adds nothing in front of the exporter it was given", () => {
      createProcessObservability({
        serviceName: "langwatch-api",
        setup: { langwatch: { apiKey: "lw-key" } },
      });

      expect(sdkOptions().spanProcessors).toBeUndefined();
    });
  });
});

describe("given a process that passes span processors of its own", () => {
  describe("when it composes its observability", () => {
    /** @scenario "A process that supplies its own span processors is left alone" */
    it("hands over exactly those, with nothing added", () => {
      const ownProcessor = new UnexportedSpanProcessor();

      createProcessObservability({
        serviceName: "langwatch-api",
        setup: { langwatch: "disabled", spanProcessors: [ownProcessor] },
      });

      expect(sdkOptions().spanProcessors).toEqual([ownProcessor]);
    });
  });
});

describe("given a caller sharing an already-built observability graph", () => {
  describe("when a second application composes its observability", () => {
    /** @scenario "A shared observability handle is returned as-is, without a second SDK setup" */
    it("returns the same handle and never calls the SDK again", () => {
      const shared = createProcessObservability({
        serviceName: "langwatch-worker",
        setup: { langwatch: "disabled" },
      });
      setupObservability.mockClear();

      const reused = createProcessObservability({
        serviceName: "langwatch-api",
        sharedHandle: shared,
      });

      expect(reused).toBe(shared);
      expect(setupObservability).not.toHaveBeenCalled();
    });
  });
});

const settings = (over: Partial<TelemetrySettings>): TelemetrySettings => ({
  otlpEndpoint: void 0,
  environment: "test",
  serviceVersion: void 0,
  resourceAttributes: void 0,
  tracesSampleRatio: void 0,
  logs: {
    format: void 0,
    level: void 0,
    consoleLevel: void 0,
    otelLevel: void 0,
    otelExport: false,
  },
  metrics: { mode: "otlp", enabled: true },
  ...over,
});

/** A resolver answering one handle, recording which handles were asked for. */
function contextWith(over: Partial<TelemetrySettings>, headers?: string) {
  const asked: TelemetrySecret[] = [];
  return {
    asked,
    context: {
      config: { observability: settings(over) },
      secrets: {
        into: async <Out>(
          handle: TelemetrySecret,
          build: (value: string | undefined) => Out | Promise<Out>,
        ) => {
          asked.push(handle);
          return build(headers);
        },
      },
    },
  };
}

describe("given a process composing telemetry from its declared slice", () => {
  describe("when a collector is configured", () => {
    it("exports platform spans to the collector, never to the product's ingest", async () => {
      await processTelemetry("langwatch-api")(
        contextWith({ otlpEndpoint: "http://collector.test:4318" }).context,
      );

      const options = sdkOptions();
      expect(options.langwatch).toBe("disabled");
      expect(options.spanProcessors).toHaveLength(1);
      expect(options.spanProcessors?.[0]).not.toBeInstanceOf(UnexportedSpanProcessor);
    });

    /** @scenario "The headers reach the exporter through the resolver" */
    it("reads the collector credential through its declared handle", async () => {
      const { asked, context } = contextWith(
        { otlpEndpoint: "http://collector.test:4318" },
        "Authorization=Bearer collector-token",
      );

      await processTelemetry("langwatch-api")(context);

      expect(asked.map((handle) => handle.id)).toEqual(["OTEL_EXPORTER_OTLP_HEADERS"]);
    });
  });

  describe("when a sampling ratio is configured", () => {
    it("builds a sampler, and leaves the SDK default alone without one", async () => {
      await processTelemetry("langwatch-api")(contextWith({ tracesSampleRatio: 0.1 }).context);
      expect(sdkOptions().sampler).toBeDefined();

      setupObservability.mockClear();
      await processTelemetry("langwatch-api")(contextWith({}).context);
      expect(sdkOptions().sampler).toBeUndefined();
    });
  });

  describe("when the process shuts down", () => {
    it("answers with the logger and a component that flushes", async () => {
      const telemetry = await processTelemetry("langwatch-api")(contextWith({}).context);

      expect(typeof telemetry.logger.info).toBe("function");
      expect(telemetry.component.name).toBe("process telemetry");
      await expect(telemetry.component.stop()).resolves.not.toThrow();
    });
  });
});
