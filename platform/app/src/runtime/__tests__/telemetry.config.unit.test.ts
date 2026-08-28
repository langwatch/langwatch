import { describe, expect, it } from "vitest";
import { resolveTelemetryConfiguration } from "../telemetry.config";

describe("resolveTelemetryConfiguration", () => {
  it("projects the process boundary without changing telemetry defaults", () => {
    expect(resolveTelemetryConfiguration({})).toEqual({
      otlpEndpoint: undefined,
      otlpHeaders: {},
      otlpTracesHeaders: {},
      otlpLogsHeaders: {},
      otlpMetricsHeaders: {},
      langwatchApiKey: undefined,
      pinoOtelEnabled: false,
      serviceName: undefined,
      deploymentEnvironment: undefined,
      resourceAttributes: undefined,
      resourceAttributesMap: {},
      tracesSampler: undefined,
      tracesSamplerArg: undefined,
      metricsEnabled: false,
      pyroscopeServerAddress: undefined,
      nodeEnvironment: undefined,
      redisCommandTracingEnabled: false,
    });
  });

  it("normalises endpoint joins and preserves the profiler fallback", () => {
    expect(
      resolveTelemetryConfiguration({
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.example///",
        OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer%20generic,x-scope=all",
        OTEL_EXPORTER_OTLP_TRACES_HEADERS: "x-scope=traces",
        OTEL_EXPORTER_OTLP_LOGS_HEADERS: "x-scope=logs",
        OTEL_EXPORTER_OTLP_METRICS_HEADERS: "x-scope=metrics",
        LANGWATCH_API_KEY: "lw-key",
        PINO_OTEL_ENABLED: "true",
        OTEL_SERVICE_NAME: "custom-app",
        ENVIRONMENT: "staging",
        OTEL_RESOURCE_ATTRIBUTES: "langwatch.worktree=alice,service.version=git%2Dabc%2C1",
        OTEL_TRACES_SAMPLER: "parentbased_traceidratio",
        OTEL_TRACES_SAMPLER_ARG: "0.25",
        OTEL_METRICS_ENABLED: "true",
        PYROSCOPE_SERVER_ADDRESS: "https://pyroscope.example",
        NODE_ENV: "production",
        OTEL_TRACE_REDIS_COMMANDS: "true",
      }),
    ).toEqual({
      otlpEndpoint: "https://otel.example",
      otlpHeaders: { Authorization: "Bearer generic", "x-scope": "all" },
      otlpTracesHeaders: { "x-scope": "traces" },
      otlpLogsHeaders: { "x-scope": "logs" },
      otlpMetricsHeaders: { "x-scope": "metrics" },
      langwatchApiKey: "lw-key",
      pinoOtelEnabled: true,
      serviceName: "custom-app",
      deploymentEnvironment: "staging",
      resourceAttributes: "langwatch.worktree=alice,service.version=git%2Dabc%2C1",
      resourceAttributesMap: {
        "langwatch.worktree": "alice",
        "service.version": "git-abc,1",
      },
      tracesSampler: "parentbased_traceidratio",
      tracesSamplerArg: "0.25",
      metricsEnabled: true,
      pyroscopeServerAddress: "https://pyroscope.example",
      nodeEnvironment: "production",
      redisCommandTracingEnabled: true,
    });
  });

  it("keeps non-literal true switches disabled", () => {
    const config = resolveTelemetryConfiguration({
      PINO_OTEL_ENABLED: "1",
      OTEL_METRICS_ENABLED: "yes",
      OTEL_TRACE_REDIS_COMMANDS: "TRUE",
    });

    expect(config.pinoOtelEnabled).toBe(false);
    expect(config.metricsEnabled).toBe(false);
    expect(config.redisCommandTracingEnabled).toBe(false);
  });

  it("drops malformed resource attributes instead of partially projecting them", () => {
    expect(
      resolveTelemetryConfiguration({
        OTEL_RESOURCE_ATTRIBUTES: "service.name=platform,malformed",
      }).resourceAttributesMap,
    ).toEqual({});
  });

  it("rejects non-string boolean switch values", () => {
    expect(() =>
      resolveTelemetryConfiguration({
        PINO_OTEL_ENABLED: true,
      }),
    ).toThrow(/pinoOtelEnabled/);
  });
});
