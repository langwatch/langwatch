/**
 * One shared block per concern that `apps/api`, `apps/worker` and (where its
 * shape matches) `apps/tasks` all spread into their own definitions. What
 * belongs here is that each block reads its OWN declared variables into its
 * OWN declared leaves — the composition-simplification win these blocks exist
 * for is proven by app-side tests calling `resolveApiConfig` /
 * `resolveWorkerConfig` and getting the same values back.
 */
import { describe, expect, it } from "vitest";

import { authzConfigDefinition } from "../authz.config";
import { clickhouseConfigDefinition } from "../clickhouse.config";
import { egressConfigDefinition } from "../egress.config";
import { githubAppConfigDefinition } from "../github.config";
import { licensingConfigDefinition } from "../licensing.config";
import { loggerConfigDefinition } from "../logger.config";
import { mailConfigDefinition } from "../mail.config";
import { objectStorageConfigDefinition } from "../object-storage.config";
import { observabilityConfigDefinition } from "../observability.config";
import { postgresConfigDefinition } from "../postgres.config";
import { groupQueueConfigDefinition } from "../queue.config";
import { redisConfigDefinition } from "../redis.config";
import { runtimeIdentityConfigDefinition } from "../runtime-identity.config";
import { RuntimeConfig } from "../runtime-config";

describe("shared configuration blocks", () => {
  it("resolves the shared Postgres connection from DATABASE_URL", () => {
    const value = RuntimeConfig.create({
      name: "postgres-block",
      definition: postgresConfigDefinition,
      source: { DATABASE_URL: "postgresql://localhost/langwatch" },
    }).value;

    expect(value).toEqual({ url: "postgresql://localhost/langwatch" });
    expect(
      RuntimeConfig.create({ name: "postgres-block", definition: postgresConfigDefinition, source: {} })
        .value.url,
    ).toBeUndefined();
  });

  it("resolves the shared Redis endpoint from REDIS_URL, REDIS_CLUSTER_ENDPOINTS and REDIS_DB_INDEX", () => {
    const value = RuntimeConfig.create({
      name: "redis-block",
      definition: redisConfigDefinition,
      source: {
        REDIS_URL: "redis://redis.example.test:6379",
        REDIS_CLUSTER_ENDPOINTS: "redis-1:6379,redis-2:6379",
        REDIS_DB_INDEX: "4",
      },
    }).value;

    expect(value).toEqual({
      url: "redis://redis.example.test:6379",
      clusterEndpoints: "redis-1:6379,redis-2:6379",
      dbIndex: "4",
    });
  });

  it("resolves the shared ClickHouse endpoint from CLICKHOUSE_URL", () => {
    const value = RuntimeConfig.create({
      name: "clickhouse-block",
      definition: clickhouseConfigDefinition,
      source: { CLICKHOUSE_URL: "http://clickhouse.example.test:8123" },
    }).value;

    expect(value).toEqual({ url: "http://clickhouse.example.test:8123" });
  });

  it("resolves the shared object storage block's backend, S3 and Azure leaves", () => {
    const value = RuntimeConfig.create({
      name: "object-storage-block",
      definition: objectStorageConfigDefinition,
      source: {
        STORED_OBJECTS_BACKEND: "azure",
        LANGWATCH_LOCAL_STORAGE_PATH: "/data/objects",
        S3_BUCKET_NAME: "langwatch-storage",
        AZURE_BLOB_ACCOUNT_NAME: "langwatchstorage",
        AZURE_TENANT_ID: "tenant-1",
      },
    }).value;

    expect(value.backend).toBe("azure");
    expect(value.localFilesystemRoot).toBe("/data/objects");
    expect(value.s3.bucket).toBe("langwatch-storage");
    expect(value.azure.accountName).toBe("langwatchstorage");
    expect(value.azure.identity.tenantId).toBe("tenant-1");
  });

  it("resolves the shared mail gateway block across every transport", () => {
    const value = RuntimeConfig.create({
      name: "mail-block",
      definition: mailConfigDefinition,
      source: {
        EMAIL_PROVIDER: "smtp",
        SMTP_HOST: "smtp.acme.test",
        SMTP_PORT: "587",
        SENDGRID_API_KEY: "sg-key",
        RESEND_API_KEY: "re-key",
      },
    }).value;

    expect(value.provider).toBe("smtp");
    expect(value.smtp).toMatchObject({ host: "smtp.acme.test", port: "587" });
    expect(value.sendgrid.apiKey).toBe("sg-key");
    expect(value.resend.apiKey).toBe("re-key");
  });

  it("resolves the shared GroupQueue dispatch knobs", () => {
    const value = RuntimeConfig.create({
      name: "queue-block",
      definition: groupQueueConfigDefinition,
      source: {
        GLOBAL_QUEUE_CONCURRENCY: "12",
        GROUP_QUEUE_ZSTD_WRITES_ENABLED: "true",
        LANGWATCH_DISPATCH_TENANT_CAP: "0",
      },
    }).value;

    expect(value).toMatchObject({
      globalConcurrency: "12",
      zstdWritesEnabled: "true",
      tenantConcurrencyCap: "0",
    });
  });

  it("resolves the shared egress policy through the deployment's one-or-true rule", () => {
    expect(
      RuntimeConfig.create({
        name: "egress-block",
        definition: egressConfigDefinition,
        source: { BLOCK_LOCAL_HTTP_CALLS: "true", ALLOWED_PROXY_HOSTS: "proxy.example.test" },
      }).value,
    ).toEqual({ blockLocalHttpCalls: true, allowedProxyHosts: "proxy.example.test" });

    expect(
      RuntimeConfig.create({
        name: "egress-block",
        definition: egressConfigDefinition,
        source: { BLOCK_LOCAL_HTTP_CALLS: "yes" },
      }).value.blockLocalHttpCalls,
    ).toBe(false);
  });

  it("resolves the shared LangWatch SDK observability identity", () => {
    const value = RuntimeConfig.create({
      name: "observability-block",
      definition: observabilityConfigDefinition,
      source: {
        LANGWATCH_API_KEY: "sk-lw-test",
        LANGWATCH_ENDPOINT: "https://telemetry.example.test",
        LANGWATCH_PROCESSOR_TYPE: "simple",
      },
    }).value;

    expect(value).toEqual({
      apiKey: "sk-lw-test",
      endpoint: "https://telemetry.example.test",
      processorType: "simple",
    });
  });

  it("resolves the shared logger knobs", () => {
    const value = RuntimeConfig.create({
      name: "logger-block",
      definition: loggerConfigDefinition,
      source: {
        LOG_FORMAT: "json",
        LOG_LEVEL: "info",
        LOG_CONSOLE_LEVEL: "warn",
        LOG_OTEL_EXPORT_ENABLED: "true",
      },
    }).value;

    expect(value).toEqual({
      format: "json",
      level: "info",
      consoleLevel: "warn",
      otelExportEnabled: true,
    });
  });

  it("resolves the shared AuthZ switches", () => {
    const value = RuntimeConfig.create({
      name: "authz-block",
      definition: authzConfigDefinition,
      source: { AUTHZ_EPOCH_CACHE: "1", DEMO_PROJECT_ID: "project-1" },
    }).value;

    expect(value).toEqual({ epochCache: "1", demoProjectId: "project-1" });
  });

  it("resolves the shared runtime identity, defaulting to a local development boot", () => {
    expect(
      RuntimeConfig.create({
        name: "runtime-identity-block",
        definition: runtimeIdentityConfigDefinition,
        source: {},
      }).value,
    ).toEqual({ environment: "local", nodeEnvironment: "development", serviceVersion: undefined });

    expect(
      RuntimeConfig.create({
        name: "runtime-identity-block",
        definition: runtimeIdentityConfigDefinition,
        source: { ENVIRONMENT: "eu-west", NODE_ENV: "production", SERVICE_VERSION: "build-42" },
      }).value,
    ).toEqual({ environment: "eu-west", nodeEnvironment: "production", serviceVersion: "build-42" });
  });

  it("resolves the shared Enterprise licensing public key", () => {
    expect(
      RuntimeConfig.create({
        name: "licensing-block",
        definition: licensingConfigDefinition,
        source: { LANGWATCH_LICENSE_PUBLIC_KEY: "rotated-key" },
      }).value,
    ).toEqual({ publicKey: "rotated-key" });
  });

  it("resolves the shared Langy GitHub App identity leaves", () => {
    expect(
      RuntimeConfig.create({
        name: "github-block",
        definition: githubAppConfigDefinition,
        source: { GITHUB_LANGY_APP_ID: "12345", GITHUB_LANGY_HOST: "github.acme.test" },
      }).value,
    ).toEqual({ appId: "12345", host: "github.acme.test" });
  });
});
