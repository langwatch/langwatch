/**
 * The insert-only writer's credentials (ADR-202 Decided 12): parsed from their own variables,
 * connected only where the system is absent, and a route the writer lacks refused by name.
 * @see specs/clickhouse/app-writer-identity.feature
 */
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { describe, expect, it } from "vitest";

import { clickhouseIdentitiesOf } from "../clickhouse-identities.ts";
import { storesOwner, type StoresConfig } from "../config-owner.ts";
import { openStores } from "../open-stores.ts";
import { PipelineParticipation } from "../pipeline-selection.ts";

const storesConfig: StoresConfig = {
  defaultRetentionDays: 30,
  shutdownDrainTimeoutMs: undefined,
  queueConcurrency: undefined,
  queueTenantCap: undefined,
  queueGlobalBudget: undefined,
  clickhouseStatementLaneReserveShare: undefined,
  clickhousePasswordFile: undefined,
  clickhouseShadowSampleRate: 0,
  clickhousePool: {
    override: undefined,
    replicas: undefined,
    serverMaxConcurrentQueries: undefined,
    serverNodes: undefined,
    clientsPerProcess: undefined,
  },
  rateLimit: { requests: 60, seconds: 60 },
  redis: { dbIndex: undefined },
  objectStorage: {
    backend: "file",
    localRoot: "/tmp/langwatch-clickhouse-writer-identity-test",
    s3: { bucket: undefined, endpoint: undefined, region: undefined },
    azure: {
      authMode: undefined,
      accountName: undefined,
      container: undefined,
      endpoint: undefined,
      authorityHost: undefined,
      tokenAudience: undefined,
      allowInsecureTokenEndpointForTests: undefined,
      identity: { tenantId: undefined, clientId: undefined, federatedTokenFile: undefined },
    },
  },
};

/** The tenant directory reads Postgres lazily; nothing here connects. */
const DATABASE = { DATABASE_URL: "postgresql://langwatch@database.invalid:5432/langwatch" };

async function withClickHouse<T>(
  environment: Record<string, string>,
  use: (client: Awaited<ReturnType<typeof openStores>>["members"]) => Promise<T>,
): Promise<T> {
  const resolver = SecretsResolver.over(
    SecretsChain.start({ environment: { ...DATABASE, ...environment } }).withEnv(),
  );
  const { members } = await openStores({
    name: "clickhouse-writer-identity-test",
    config: storesConfig,
    secrets: resolver.scopeTo(storesOwner.name, Object.values(storesOwner.secrets)),
    pipelines: PipelineParticipation.producer(),
    production: false,
  });
  try {
    return await use(members);
  } finally {
    await members.close();
  }
}

async function refusalOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("expected a refusal");
}

const ORG_INSERT = {
  tenantId: "project_1",
  organizationId: "org_1",
  table: "dspy_steps",
  rows: [{ TenantId: "project_1" }],
};

describe("clickhouseIdentitiesOf() with the writer", () => {
  /** @scenario "The writer's credential is read from CLICKHOUSE_WRITER_URL and its route family" */
  it("resolves the writer's shared server and its own route", () => {
    const identities = clickhouseIdentitiesOf({
      config: {
        readerUrl: "http://reader.invalid:8123",
        writerUrl: "http://writer.invalid:8123",
        readerPrivateRoutes: [
          { organizationId: "org_1", url: "http://one-reader.invalid:8123", label: "eu" },
        ],
        writerPrivateRoutes: [
          { organizationId: "org_1", url: "http://one-writer.invalid:8123", label: "eu" },
        ],
      },
    });

    expect(identities.system).toBeUndefined();
    expect(identities.writer?.shared?.url).toBe("http://writer.invalid:8123");
    expect(identities.writer?.missingPrivateRoutes?.size).toBe(0);
    expect(identities.reader?.missingPrivateRoutes?.size).toBe(0);
  });

  /** @scenario "An organisation routed for the system or the reader but not the writer refuses its inserts" */
  it("marks a route the system or the reader has and the writer lacks by the writer's variable", () => {
    const identities = clickhouseIdentitiesOf({
      config: {
        url: "http://system.invalid:8123",
        readerUrl: "http://reader.invalid:8123",
        writerUrl: "http://writer.invalid:8123",
        privateRoutes: [{ organizationId: "org_1", url: "http://one.invalid:8123", label: "eu" }],
        readerPrivateRoutes: [
          { organizationId: "org_1", url: "http://one-reader.invalid:8123", label: "eu" },
        ],
      },
    });

    expect([...(identities.writer?.missingPrivateRoutes ?? [])]).toEqual([
      ["org_1", "CLICKHOUSE_WRITER_URL__eu__org_1"],
    ]);
  });
});

describe("given the stores open over the writer's variables", () => {
  describe("when the reader routes an organization the writer does not", () => {
    /** @scenario "An organisation routed for the system or the reader but not the writer refuses its inserts" */
    it("refuses its inserts naming the writer variable to set, never the shared writer", async () => {
      const error = await withClickHouse(
        {
          CLICKHOUSE_READER_URL: "http://reader.invalid:8123",
          CLICKHOUSE_READER_URL__eu__org_1: "http://one-reader.invalid:8123",
          CLICKHOUSE_WRITER_URL: "http://writer.invalid:8123",
        },
        (members) => refusalOf(() => members.read("clickhouse").insert(ORG_INSERT)),
      );

      expect(error).toMatchObject({
        code: "private_dataplane_unavailable",
        meta: {
          organizationId: "org_1",
          variable: "CLICKHOUSE_WRITER_URL__eu__org_1",
          problem: "missing",
        },
      });
    });
  });

  describe("when the system, the reader and the writer are all set", () => {
    /** @scenario "A process holding the system identity connects no writer" */
    it("sends the insert as the system: an organization only the writer routes is refused by the system's variable", async () => {
      const error = await withClickHouse(
        {
          CLICKHOUSE_URL: "http://system.invalid:8123",
          CLICKHOUSE_READER_URL: "http://reader.invalid:8123",
          CLICKHOUSE_READER_URL__eu__org_1: "http://one-reader.invalid:8123",
          CLICKHOUSE_WRITER_URL: "http://writer.invalid:8123",
          CLICKHOUSE_WRITER_URL__eu__org_1: "http://one-writer.invalid:8123",
        },
        (members) => refusalOf(() => members.read("clickhouse").insert(ORG_INSERT)),
      );

      expect(error).toMatchObject({
        code: "private_dataplane_unavailable",
        meta: {
          organizationId: "org_1",
          variable: "CLICKHOUSE_URL__eu__org_1",
          problem: "missing",
        },
      });
    });
  });
});
