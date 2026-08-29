import { describe, expect, it } from "vitest";
import {
  apiLoggerConfiguration,
  apiObservabilityConfiguration,
  resolveApiConfig,
} from "../api.config";

describe("API process configuration", () => {
  it("parses the listener and drain settings once at executable composition", () => {
    expect(
      resolveApiConfig({
        ENVIRONMENT: "production",
        API_HOST: "127.0.0.1",
        API_PORT: "6560",
        API_HTTP_DRAIN_GRACE_MS: "9000",
      }),
    ).toEqual({
      processRole: "web",
      environment: "production",
      nodeEnvironment: "development",
      serviceName: "langwatch-api",
      serviceVersion: undefined,
      host: "127.0.0.1",
      port: 6560,
      httpDrainGraceMs: 9000,
      shutdown: { processDeadlineMs: 24_000 },
      logger: {
        format: undefined,
        level: undefined,
        consoleLevel: undefined,
        otelExportEnabled: undefined,
      },
      observability: {
        apiKey: undefined,
        endpoint: undefined,
        processorType: "batch",
      },
      infrastructure: {
        redis: { configured: false, reason: "unconfigured", warnings: [] },
        groupQueue: {
          globalConcurrency: undefined,
          tenantConcurrencyCap: undefined,
          globalConcurrencyBudget: undefined,
          compression: "gzip",
          payloadCodec: "json",
        },
      },
    });
  });

  it("gives the whole shutdown sequence more budget than the listener drain alone", () => {
    expect(resolveApiConfig({ API_HTTP_DRAIN_GRACE_MS: "9000" }).shutdown.processDeadlineMs).toBe(
      24_000,
    );
    expect(
      resolveApiConfig({ API_HTTP_DRAIN_GRACE_MS: "9000", API_SHUTDOWN_DEADLINE_MS: "12000" })
        .shutdown.processDeadlineMs,
    ).toBe(12_000);
  });

  it("rejects a shutdown deadline that would abort every drain immediately", () => {
    expect(() => resolveApiConfig({ API_SHUTDOWN_DEADLINE_MS: "0" })).toThrow(
      "Invalid api configuration",
    );
  });

  it("rejects invalid executable ports before a listener is constructed", () => {
    expect(() => resolveApiConfig({ API_PORT: "0" })).toThrow("Invalid api configuration");
  });

  it("fails closed when a deployment tries to assign the API a worker role", () => {
    expect(() => resolveApiConfig({ API_PROCESS_ROLE: "worker" })).toThrow(
      "Invalid api configuration",
    );
  });

  it("uses standalone compatibility aliases in deterministic precedence", () => {
    expect(
      resolveApiConfig({ API_PORT: "6560", LANGWATCH_API_PORT: "6561", PORT: "6562" }).port,
    ).toBe(6560);
    expect(resolveApiConfig({ LANGWATCH_API_PORT: "6561", PORT: "6562" }).port).toBe(6561);
    expect(resolveApiConfig({ PORT: "6562" }).port).toBe(6562);
  });

  it("projects parsed logger and telemetry settings without retaining the source", () => {
    const config = resolveApiConfig({
      NODE_ENV: "production",
      ENVIRONMENT: "eu-west",
      API_SERVICE_NAME: "api-edge",
      SERVICE_VERSION: "build-42",
      LOG_FORMAT: "json",
      LOG_LEVEL: "info",
      LOG_CONSOLE_LEVEL: "warn",
      LOG_OTEL_EXPORT_ENABLED: "true",
      LANGWATCH_API_KEY: "sk-lw-test",
      LANGWATCH_ENDPOINT: "https://telemetry.example.test",
      LANGWATCH_PROCESSOR_TYPE: "simple",
    });

    expect(apiLoggerConfiguration(config)).toMatchObject({
      environment: "production",
      format: "json",
      level: "info",
      consoleLevel: "warn",
      otelExportEnabled: true,
      serviceName: "api-edge",
      serviceVersion: "build-42",
      deploymentEnvironment: "eu-west",
    });
    expect(apiObservabilityConfiguration(config)).toMatchObject({
      serviceName: "api-edge",
      loggerName: "api-edge",
      setup: {
        langwatch: {
          apiKey: "sk-lw-test",
          endpoint: "https://telemetry.example.test",
          processorType: "simple",
        },
        attributes: {
          "deployment.environment.name": "eu-west",
          "service.version": "build-42",
        },
      },
    });
  });

  it("resolves Redis and Group Queue settings before API composition", () => {
    const config = resolveApiConfig({
      REDIS_URL: "redis://redis.example.test:6379",
      REDIS_DB_INDEX: "4",
      GLOBAL_QUEUE_CONCURRENCY: "12",
      GROUP_QUEUE_ZSTD_WRITES_ENABLED: "true",
      GROUP_QUEUE_MSGPACK_WRITES_ENABLED: "true",
      LANGWATCH_DISPATCH_TENANT_CAP: "0",
      LANGWATCH_DISPATCH_GLOBAL_BUDGET: "48",
    });

    expect(config.infrastructure).toEqual({
      redis: {
        configured: true,
        mode: "standalone",
        url: "redis://redis.example.test:6379",
        db: 4,
        tls: undefined,
        warnings: [],
      },
      groupQueue: {
        globalConcurrency: 12,
        tenantConcurrencyCap: 0,
        globalConcurrencyBudget: 48,
        compression: "zstd",
        payloadCodec: "msgpack",
      },
    });
  });
});
