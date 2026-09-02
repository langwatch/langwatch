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
      instanceAdminApiKey: undefined,
      apiKeyPepper: undefined,
      authz: { epochCacheEnabled: false, demoProjectId: undefined },
      // The rollout switches this deployment set, which is none: an empty
      // override map and an empty force-enable set, so every flag answers from
      // the registry default.
      featureFlags: { overrides: new Map(), forceEnabled: new Set() },
      infrastructure: {
        database: { url: undefined },
        clickhouse: {
          url: undefined,
          langwatchQl: undefined,
          privateRoutes: [],
          poolSizing: {
            override: undefined,
            replicas: undefined,
            serverMaxConcurrentQueries: undefined,
            serverNodes: undefined,
            clientsPerProcess: undefined,
          },
        },
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

  describe("when the API-key pepper is configured", () => {
    it("reads it from the same two variables, in the same order, as the cipher key", () => {
      expect(resolveApiConfig({ CREDENTIALS_SECRET: "from-credentials" }).apiKeyPepper).toBe(
        "from-credentials",
      );
      expect(resolveApiConfig({ NEXTAUTH_SECRET: "from-nextauth" }).apiKeyPepper).toBe(
        "from-nextauth",
      );
      expect(
        resolveApiConfig({ CREDENTIALS_SECRET: "wins", NEXTAUTH_SECRET: "loses" }).apiKeyPepper,
      ).toBe("wins");
      expect(resolveApiConfig({}).apiKeyPepper).toBeUndefined();
    });

    it("carries the value through verbatim, because it is used as an HMAC key", () => {
      const raw = "  0f0f  ";

      expect(resolveApiConfig({ CREDENTIALS_SECRET: raw }).apiKeyPepper).toBe(raw);
    });
  });

  describe("when the AuthZ switches are set", () => {
    it("reads the epoch cache the way every other tier reads it", () => {
      expect(resolveApiConfig({ AUTHZ_EPOCH_CACHE: "1" }).authz.epochCacheEnabled).toBe(true);
      expect(resolveApiConfig({ AUTHZ_EPOCH_CACHE: "true" }).authz.epochCacheEnabled).toBe(true);
      expect(resolveApiConfig({ AUTHZ_EPOCH_CACHE: "0" }).authz.epochCacheEnabled).toBe(false);
      expect(resolveApiConfig({}).authz.epochCacheEnabled).toBe(false);
    });

    it("ignores a value neither tier treats as on, rather than refusing the boot", () => {
      expect(resolveApiConfig({ AUTHZ_EPOCH_CACHE: "yes" }).authz.epochCacheEnabled).toBe(false);
    });

    it("reads a blank demo project as no demo project rather than as the empty id", () => {
      expect(resolveApiConfig({ DEMO_PROJECT_ID: "project-1" }).authz.demoProjectId).toBe(
        "project-1",
      );
      expect(resolveApiConfig({ DEMO_PROJECT_ID: "   " }).authz.demoProjectId).toBeUndefined();
      expect(resolveApiConfig({}).authz.demoProjectId).toBeUndefined();
    });
  });

  it("carries the instance administrator credential through the process's one environment read", () => {
    expect(
      resolveApiConfig({ LANGWATCH_INSTANCE_ADMIN_API_KEY: "  instance-admin-secret  " })
        .instanceAdminApiKey,
    ).toBe("  instance-admin-secret  ");
    expect(resolveApiConfig({}).instanceAdminApiKey).toBeUndefined();
  });

  it("boots with a blank instance administrator credential rather than refusing the process", () => {
    expect(resolveApiConfig({ LANGWATCH_INSTANCE_ADMIN_API_KEY: "" }).instanceAdminApiKey).toBe("");
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

  it("carries the Postgres connection the process composes its guarded client from", () => {
    expect(
      resolveApiConfig({ DATABASE_URL: "postgresql://localhost/langwatch" }).infrastructure
        .database,
    ).toEqual({ url: "postgresql://localhost/langwatch" });
  });

  it("leaves the database unconfigured rather than refusing a process that needs none", () => {
    expect(resolveApiConfig({}).infrastructure.database).toEqual({ url: undefined });
  });

  it("carries the stored-secret key the process builds its cipher from", () => {
    expect(
      resolveApiConfig({ CREDENTIALS_SECRET: "0f".repeat(32) }).storedSecretEncryptionKey,
    ).toBe("0f".repeat(32));
  });

  it("falls back to the second name the platform app has always accepted for it", () => {
    expect(resolveApiConfig({ NEXTAUTH_SECRET: "a1".repeat(32) }).storedSecretEncryptionKey).toBe(
      "a1".repeat(32),
    );
    expect(
      resolveApiConfig({
        CREDENTIALS_SECRET: "0f".repeat(32),
        NEXTAUTH_SECRET: "a1".repeat(32),
      }).storedSecretEncryptionKey,
    ).toBe("0f".repeat(32));
  });

  it("leaves the key unconfigured rather than refusing a process that composes no secrets", () => {
    expect(resolveApiConfig({}).storedSecretEncryptionKey).toBeUndefined();
    expect(resolveApiConfig({ CREDENTIALS_SECRET: "" }).storedSecretEncryptionKey).toBe("");
  });

  it("carries the metrics credential through the process's one environment read", () => {
    expect(resolveApiConfig({ METRICS_API_KEY: "scrape-me" }).metricsApiKey).toBe("scrape-me");
  });

  it("leaves the metrics credential unconfigured rather than refusing a process that serves none", () => {
    expect(resolveApiConfig({}).metricsApiKey).toBeUndefined();
    expect(resolveApiConfig({ METRICS_API_KEY: "" }).metricsApiKey).toBe("");
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
      database: { url: undefined },
      clickhouse: {
        url: undefined,
        langwatchQl: undefined,
        privateRoutes: [],
        poolSizing: {
          override: undefined,
          replicas: undefined,
          serverMaxConcurrentQueries: undefined,
          serverNodes: undefined,
          clientsPerProcess: undefined,
        },
      },
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
