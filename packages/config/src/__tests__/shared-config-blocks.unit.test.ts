/**
 * One shared INFRASTRUCTURE block per concern that `apps/api`, `apps/worker`
 * and (where its shape matches) `apps/tasks` all spread into their own
 * definitions. A block a single feature owns lives in that feature's contract
 * instead, beside the rules that read it.
 */
import { describe, expect, it } from "vitest";

import { clickhouseConfigDefinition } from "../clickhouse.config.ts";
import { loggerConfigDefinition } from "../logger.config.ts";
import { observabilityConfigDefinition } from "../observability.config.ts";
import { postgresConfigDefinition } from "../postgres.config.ts";
import { groupQueueConfigDefinition } from "../queue.config.ts";
import { redisConfigDefinition } from "../redis.config.ts";
import { runtimeIdentityConfigDefinition } from "../runtime-identity.config.ts";
import { trustedProxyConfigDefinition } from "../trusted-proxy.config.ts";
import { RuntimeConfig } from "../runtime-config.ts";

describe("shared configuration blocks", () => {
  it("resolves the shared Postgres connection from DATABASE_URL", () => {
    const value = RuntimeConfig.create({
      name: "postgres-block",
      definition: postgresConfigDefinition,
      source: { DATABASE_URL: "postgresql://localhost/langwatch" },
    }).value;

    expect(value).toEqual({ url: "postgresql://localhost/langwatch" });
    expect(
      RuntimeConfig.create({
        name: "postgres-block",
        definition: postgresConfigDefinition,
        source: {},
      }).value.url,
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
    ).toEqual({
      environment: "eu-west",
      nodeEnvironment: "production",
      serviceVersion: "build-42",
    });
  });

  /** @scenario "A forwarding header from an untrusted peer is ignored" */
  it("resolves the trusted proxy list, defaulting to none so no forwarding header is trusted", () => {
    expect(
      RuntimeConfig.create({
        name: "trusted-proxy-block",
        definition: trustedProxyConfigDefinition,
        source: { TRUSTED_PROXY_ADDRESSES: "198.51.100.4,10.0.0.0/8" },
      }).value,
    ).toEqual({ trustedProxies: "198.51.100.4,10.0.0.0/8" });

    expect(
      RuntimeConfig.create({
        name: "trusted-proxy-block",
        definition: trustedProxyConfigDefinition,
        source: {},
      }).value.trustedProxies,
    ).toBeUndefined();
  });
});
