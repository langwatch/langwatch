import { describe, expect, it } from "vitest";
import { isNodeInstrumentationRuntime, resolveTelemetryConfiguration } from "../src";

describe("telemetry configuration projection", () => {
  it("keeps the Next runtime gate outside the legacy application runtime", () => {
    expect(isNodeInstrumentationRuntime({ NEXT_RUNTIME: "nodejs" })).toBe(true);
    expect(isNodeInstrumentationRuntime({ NEXT_RUNTIME: "edge" })).toBe(false);
    expect(isNodeInstrumentationRuntime({})).toBe(false);
  });

  it("normalizes OTLP endpoints, signal headers and resource attributes", () => {
    expect(
      resolveTelemetryConfiguration({
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example///",
        OTEL_EXPORTER_OTLP_HEADERS: "x-shared=ambient,x-generic-only=ambient",
        OTEL_EXPORTER_OTLP_TRACES_HEADERS: "x-signal=traces",
        OTEL_EXPORTER_OTLP_LOGS_HEADERS: "x-signal=logs",
        OTEL_EXPORTER_OTLP_METRICS_HEADERS: "x-signal=metrics",
        OTEL_RESOURCE_ATTRIBUTES: "service.name=langwatch,service.version=git%2Dabc%2C1",
        OTEL_SERVICE_NAME: "custom-app",
        ENVIRONMENT: "preview",
      }),
    ).toMatchObject({
      otlpEndpoint: "https://collector.example",
      otlpHeaders: { "x-shared": "ambient", "x-generic-only": "ambient" },
      otlpTracesHeaders: { "x-signal": "traces" },
      otlpLogsHeaders: { "x-signal": "logs" },
      otlpMetricsHeaders: { "x-signal": "metrics" },
      resourceAttributesMap: {
        "service.name": "langwatch",
        "service.version": "git-abc,1",
      },
      serviceName: "custom-app",
      deploymentEnvironment: "preview",
    });
  });

  it("keeps legacy literal-true instrumentation switches and safe malformed values", () => {
    expect(
      resolveTelemetryConfiguration({
        PINO_OTEL_ENABLED: "1",
        OTEL_METRICS_ENABLED: "yes",
        OTEL_TRACE_REDIS_COMMANDS: "TRUE",
        OTEL_RESOURCE_ATTRIBUTES: "service.name=platform,malformed",
      }),
    ).toMatchObject({
      pinoOtelEnabled: false,
      metricsEnabled: false,
      redisCommandTracingEnabled: false,
      resourceAttributesMap: {},
    });
  });

  it("does not retain unrelated source values or raw invalid header pairs", () => {
    const config = resolveTelemetryConfiguration({
      OTEL_EXPORTER_OTLP_HEADERS: "valid=value,missing,=empty,bad=%off",
      UNRELATED_SECRET: "must-not-cross-the-boundary",
    });

    expect(config.otlpHeaders).toEqual({ valid: "value" });
    expect(config).not.toHaveProperty("UNRELATED_SECRET");
  });
});
