import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  registerTelemetryFlush: vi.fn(),
  startProfiling: vi.fn(),
}));

vi.mock("../../server/profiling/startProfiling", () => ({
  startProfiling: mocks.startProfiling,
}));

vi.mock("../../server/shutdown/telemetry", () => ({
  registerTelemetryFlush: mocks.registerTelemetryFlush,
}));

describe("initializeInstrumentation", () => {
  beforeEach(() => {
    mocks.registerTelemetryFlush.mockReset();
    mocks.startProfiling.mockReset();
  });

  it("keeps projected OTLP headers authoritative for every signal", async () => {
    const envNames = [
      "OTEL_EXPORTER_OTLP_HEADERS",
      "OTEL_EXPORTER_OTLP_TRACES_HEADERS",
      "OTEL_EXPORTER_OTLP_LOGS_HEADERS",
      "OTEL_EXPORTER_OTLP_METRICS_HEADERS",
    ] as const;
    const previousEnvironment = Object.fromEntries(
      envNames.map((name) => [name, process.env[name]]),
    );

    try {
      process.env.OTEL_EXPORTER_OTLP_HEADERS = "x-shared=ambient,x-generic-only=ambient";
      process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS = "x-signal=ambient-traces";
      process.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS = "x-signal=ambient-logs";
      process.env.OTEL_EXPORTER_OTLP_METRICS_HEADERS = "x-signal=ambient-metrics";

      const { createAuthoritativeOtlpConfiguration } = await import("../../instrumentation.node");
      const getSharedConfigurationDefaults = () => ({
        timeoutMillis: 10_000,
        concurrencyLimit: 30,
        compression: "none" as const,
      });
      const httpAgentFactoryFromOptions =
        (_options: { keepAlive: boolean }) => async (_protocol: string) => {
          throw new Error("the test does not create an HTTP agent");
        };

      for (const signal of ["traces", "logs", "metrics"] as const) {
        const projectedHeaders = {
          "x-shared": `projected-${signal}`,
          "x-signal": `projected-${signal}`,
          "x-projected-only": signal,
        };
        const configuration = createAuthoritativeOtlpConfiguration(
          `https://collector.example/v1/${signal}`,
          projectedHeaders,
          "application/x-protobuf",
          getSharedConfigurationDefaults,
          httpAgentFactoryFromOptions,
        );

        await expect(configuration.headers()).resolves.toEqual({
          ...projectedHeaders,
          "Content-Type": "application/x-protobuf",
        });
      }
    } finally {
      for (const name of envNames) {
        const value = previousEnvironment[name];
        if (value === void 0) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it("initializes once and owns the profiler through the shared flush boundary", async () => {
    const previousApiKey = process.env.LANGWATCH_API_KEY;
    delete process.env.LANGWATCH_API_KEY;

    try {
      const stop = vi.fn().mockResolvedValue(void 0);
      mocks.startProfiling.mockReturnValue({ stop });

      const { resolveTelemetryConfiguration } = await import("../telemetry.config");
      const { initializeInstrumentation } = await import("../../instrumentation.node");
      const config = resolveTelemetryConfiguration({
        PYROSCOPE_SERVER_ADDRESS: "https://pyroscope.example",
      });

      initializeInstrumentation(config);
      initializeInstrumentation(config);

      expect(mocks.startProfiling).toHaveBeenCalledTimes(1);
      expect(mocks.registerTelemetryFlush).toHaveBeenCalledTimes(1);
      expect(mocks.registerTelemetryFlush).toHaveBeenCalledWith({
        name: "profiling",
        run: expect.any(Function),
      });

      const profilingFlush = mocks.registerTelemetryFlush.mock.calls[0]?.[0] as {
        run: () => Promise<void>;
      };
      await profilingFlush.run();
      expect(stop).toHaveBeenCalledTimes(1);
    } finally {
      if (previousApiKey === void 0) delete process.env.LANGWATCH_API_KEY;
      else process.env.LANGWATCH_API_KEY = previousApiKey;
    }
  });

  it("applies the platform API-key guard to projected config", async () => {
    const { resolveTelemetryConfiguration } = await import("../telemetry.config");
    const { initializeInstrumentation } = await import("../../instrumentation.node");
    const config = resolveTelemetryConfiguration({ LANGWATCH_API_KEY: "projected-key" });

    expect(() => initializeInstrumentation(config)).toThrow(
      /must not be set on a langwatch platform/,
    );
  });
});
