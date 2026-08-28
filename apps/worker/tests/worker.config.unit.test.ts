import { InvalidRuntimeConfigError } from "@langwatch/config";
import { describe, expect, it } from "vitest";
import { resolveWorkerConfig } from "../src/platform/config/worker.config";

describe("resolveWorkerConfig", () => {
  it("uses the worker-local environment default", () => {
    const config = resolveWorkerConfig({});

    expect(config).toEqual({
      processRole: "worker",
      environment: "local",
      nodeEnvironment: "development",
      serviceName: "langwatch:worker",
      serviceVersion: undefined,
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
      eventing: { consumersEnabled: false },
      shutdown: { processDeadlineMs: 25_000 },
      infrastructure: {
        redis: { configured: false, reason: "unconfigured", warnings: [] },
        groupQueue: {
          globalConcurrency: undefined,
          tenantConcurrencyCap: undefined,
          globalConcurrencyBudget: undefined,
          compression: "gzip",
          payloadCodec: "json",
        },
        storage: {
          backend: "s3",
          localFilesystemRoot: "/var/lib/langwatch/objects",
          s3: {
            bucket: undefined,
            endpoint: undefined,
            region: undefined,
            accessKeyId: undefined,
            secretAccessKey: undefined,
            sessionToken: undefined,
          },
        },
        outboundProxy: { https: undefined, http: undefined, noProxy: undefined },
      },
    });
  });

  it("reads a semantic environment value from its process source", () => {
    const config = resolveWorkerConfig({ ENVIRONMENT: "production" });

    expect(config.environment).toBe("production");
    expect(config.nodeEnvironment).toBe("development");
    expect(config.eventing.consumersEnabled).toBe(false);
  });

  it("parses tracing credentials at the process boundary without exposing them in errors", () => {
    const config = resolveWorkerConfig({
      LANGWATCH_API_KEY: "key-for-worker",
      LANGWATCH_ENDPOINT: "https://collector.example.test",
      LANGWATCH_PROCESSOR_TYPE: "simple",
    });

    expect(config.observability).toEqual({
      apiKey: "key-for-worker",
      endpoint: "https://collector.example.test",
      processorType: "simple",
    });
  });

  it("parses the production runtime mode used for Eventing diagnostics", () => {
    const config = resolveWorkerConfig({ NODE_ENV: "production" });

    expect(config.nodeEnvironment).toBe("production");
  });

  it("preserves the legacy worker logger compatibility spellings", () => {
    const config = resolveWorkerConfig({
      OTEL_SERVICE_NAME: "legacy-worker",
      PINO_LOG_LEVEL: "debug",
      PINO_CONSOLE_LEVEL: "warn",
      PINO_OTEL_ENABLED: "true",
    });

    expect(config.serviceName).toBe("legacy-worker");
    expect(config.logger).toEqual({
      format: undefined,
      level: "debug",
      consoleLevel: "warn",
      otelExportEnabled: true,
    });
  });

  it("preserves the Worker shutdown budget defaults and positive override", () => {
    expect(
      resolveWorkerConfig({ NODE_ENV: "production", ENVIRONMENT: "production" }).shutdown,
    ).toEqual({ processDeadlineMs: 45_000 });
    expect(resolveWorkerConfig({ SHUTDOWN_DRAIN_TIMEOUT_MS: "60000" }).shutdown).toEqual({
      processDeadlineMs: 80_000,
    });
    expect(resolveWorkerConfig({ SHUTDOWN_DRAIN_TIMEOUT_MS: "invalid" }).shutdown).toEqual({
      processDeadlineMs: 25_000,
    });
  });

  it("resolves Worker-private Redis, queue, storage, and proxy settings once", () => {
    const config = resolveWorkerConfig({
      REDIS_URL: "redis://redis.example.test:6379",
      REDIS_DB_INDEX: "4",
      GLOBAL_QUEUE_CONCURRENCY: "12",
      GROUP_QUEUE_ZSTD_WRITES_ENABLED: "true",
      GROUP_QUEUE_MSGPACK_WRITES_ENABLED: "true",
      LANGWATCH_DISPATCH_TENANT_CAP: "0",
      LANGWATCH_DISPATCH_GLOBAL_BUDGET: "48",
      S3_BUCKET_NAME: "worker-bucket",
      S3_ENDPOINT: "https://storage.example.test",
      S3_REGION: "eu-west-1",
      S3_ACCESS_KEY_ID: "access-key",
      S3_SECRET_ACCESS_KEY: "secret-key",
      S3_SESSION_TOKEN: "session-token",
      LANGWATCH_LOCAL_STORAGE_PATH: "/worker/objects",
      HTTPS_PROXY: " https://proxy.example.test:8443 ",
      NO_PROXY: " internal.example.test ",
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
      storage: {
        backend: "s3",
        localFilesystemRoot: "/worker/objects",
        s3: {
          bucket: "worker-bucket",
          endpoint: "https://storage.example.test",
          region: "eu-west-1",
          accessKeyId: "access-key",
          secretAccessKey: "secret-key",
          sessionToken: "session-token",
        },
      },
      outboundProxy: {
        https: "https://proxy.example.test:8443",
        http: undefined,
        noProxy: "internal.example.test",
      },
    });
  });

  it("preserves empty S3 credentials as the default AWS credential chain", () => {
    const config = resolveWorkerConfig({
      S3_BUCKET_NAME: "worker-bucket",
      S3_ACCESS_KEY_ID: "",
      S3_SECRET_ACCESS_KEY: "",
      S3_SESSION_TOKEN: "",
    });

    expect(config.infrastructure.storage.s3).toEqual({
      bucket: "worker-bucket",
      endpoint: undefined,
      region: undefined,
      accessKeyId: undefined,
      secretAccessKey: undefined,
      sessionToken: undefined,
    });
  });

  it("preserves the legacy S3 region fallback for explicit credentials and custom endpoints", () => {
    expect(
      resolveWorkerConfig({
        S3_ACCESS_KEY_ID: "access-key",
        S3_SECRET_ACCESS_KEY: "secret-key",
      }).infrastructure.storage.s3.region,
    ).toBe("auto");
    expect(
      resolveWorkerConfig({ S3_ENDPOINT: "https://minio.example.test" }).infrastructure.storage.s3
        .region,
    ).toBe("auto");
  });

  it("honours lower-case outbound-proxy compatibility variables", () => {
    const config = resolveWorkerConfig({
      https_proxy: "https://proxy.example.test",
      no_proxy: ".internal.example.test",
    });

    expect(config.infrastructure.outboundProxy).toEqual({
      https: "https://proxy.example.test",
      http: undefined,
      noProxy: ".internal.example.test",
    });
  });

  it("rejects invalid configuration before a worker graph can boot", () => {
    expect(() => resolveWorkerConfig({ ENVIRONMENT: "" })).toThrow(InvalidRuntimeConfigError);
  });

  it("fails closed when a deployment assigns the worker a web role", () => {
    expect(() => resolveWorkerConfig({ WORKER_PROCESS_ROLE: "web" })).toThrow(
      InvalidRuntimeConfigError,
    );
  });

  it("fails closed when a deployment attempts to enable partial consumers", () => {
    expect(() => resolveWorkerConfig({ WORKER_EVENTING_CONSUMERS_ENABLED: "true" })).toThrow(
      InvalidRuntimeConfigError,
    );
  });

  it("rejects an unknown stored-object backend before worker composition", () => {
    expect(() => resolveWorkerConfig({ STORED_OBJECTS_BACKEND: "gcs" })).toThrow(
      InvalidRuntimeConfigError,
    );
  });
});
