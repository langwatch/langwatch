/**
 * The app reader's credentials beside the system's (ADR-202): parsed from their own variables,
 * one connection each, and a private route the reader lacks refused for its reads by name.
 * @see specs/clickhouse/app-reader-identity.feature
 */
import { HandledError } from "@langwatch/handled-error";
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
    localRoot: "/tmp/langwatch-clickhouse-reader-identity-test",
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
    name: "clickhouse-reader-identity-test",
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

const ORG_READ = {
  tenantId: "project_1",
  organizationId: "org_1",
  sql: "SELECT TraceId FROM trace_summaries WHERE TenantId = {tenantId:String}",
  params: { tenantId: "project_1" },
  table: "trace_summaries",
};

describe("clickhouseIdentitiesOf()", () => {
  /** @scenario "The reader's credentials are their own variables beside the system's" */
  it("resolves only the system identity when no reader credential is set", () => {
    const identities = clickhouseIdentitiesOf({
      config: { url: "http://system.invalid:8123", privateRoutes: [] },
    });

    expect(identities.reader).toBeUndefined();
    expect(identities.system?.shared?.url).toBe("http://system.invalid:8123");
    expect(identities.system?.missingPrivateRoutes?.size).toBe(0);
  });

  /** @scenario "A private route with no reader credential refuses its organisation's reads by name" */
  it("marks each route one identity has and the other lacks by the other's variable", () => {
    const identities = clickhouseIdentitiesOf({
      config: {
        url: "http://system.invalid:8123",
        readerUrl: "http://reader.invalid:8123",
        privateRoutes: [{ organizationId: "org_1", url: "http://one.invalid:8123", label: "acme" }],
        readerPrivateRoutes: [
          { organizationId: "org_2", url: "http://two.invalid:8123", label: "beta" },
        ],
      },
    });

    expect([...(identities.reader?.missingPrivateRoutes ?? [])]).toEqual([
      ["org_1", "CLICKHOUSE_READER_URL__acme__org_1"],
    ]);
    expect([...(identities.system?.missingPrivateRoutes ?? [])]).toEqual([
      ["org_2", "CLICKHOUSE_URL__beta__org_2"],
    ]);
  });
});

describe("given the stores open over the reader's variables", () => {
  describe("when the reader names its shared URL and its private routes", () => {
    /** @scenario "The reader's credentials are their own variables beside the system's" */
    it("keeps CLICKHOUSE_URL's private routes as the member's routing table", async () => {
      const organizations = await withClickHouse(
        {
          CLICKHOUSE_URL: "http://system.invalid:8123",
          CLICKHOUSE_URL__acme__org_1: "http://one.invalid:8123",
          CLICKHOUSE_READER_URL: "http://reader.invalid:8123",
          CLICKHOUSE_READER_URL__acme__org_1: "http://one-reader.invalid:8123",
        },
        async (members) => [...members.read("clickhouse").privateRoutes().keys()],
      );

      expect(organizations).toEqual(["org_1"]);
    });
  });

  describe("when an organization has a system route and no reader route", () => {
    /** @scenario "A private route with no reader credential refuses its organisation's reads by name" */
    it("refuses its reads naming the reader variable to set, never the shared server", async () => {
      const error = await withClickHouse(
        {
          CLICKHOUSE_URL: "http://system.invalid:8123",
          CLICKHOUSE_URL__acme__org_1: "http://one.invalid:8123",
          CLICKHOUSE_READER_URL: "http://reader.invalid:8123",
        },
        (members) => refusalOf(() => members.read("clickhouse").query(ORG_READ)),
      );

      expect(error).toMatchObject({
        code: "private_dataplane_unavailable",
        meta: {
          organizationId: "org_1",
          variable: "CLICKHOUSE_READER_URL__acme__org_1",
          problem: "missing",
        },
      });
    });
  });

  describe("when an organization has a reader route and no system route", () => {
    /** @scenario "A private route with no system credential refuses its organisation's system statements by name" */
    it("refuses its skip-check statements naming the system variable to set, never the shared server", async () => {
      const error = await withClickHouse(
        {
          CLICKHOUSE_URL: "http://system.invalid:8123",
          CLICKHOUSE_READER_URL: "http://reader.invalid:8123",
          CLICKHOUSE_READER_URL__acme__org_1: "http://one-reader.invalid:8123",
        },
        (members) =>
          refusalOf(() =>
            members.read("clickhouse").query({
              ...ORG_READ,
              // A system statement naming one organisation, the shape billing's aggregates send.
              SKIP_TENANT_CHECK: true,
            }),
          ),
      );

      expect(error).toMatchObject({
        code: "private_dataplane_unavailable",
        meta: {
          organizationId: "org_1",
          variable: "CLICKHOUSE_URL__acme__org_1",
          problem: "missing",
        },
      });
    });
  });

  describe("when only the reader's credential is set", () => {
    /** @scenario "A process configured with only reader credentials builds a reader-only client" */
    it("builds a client that refuses inserts by name", async () => {
      const error = await withClickHouse(
        { CLICKHOUSE_READER_URL: "http://reader.invalid:8123" },
        (members) =>
          refusalOf(() =>
            members.read("clickhouse").insert({
              tenantId: "project_1",
              table: "trace_summaries",
              rows: [{ TenantId: "project_1" }],
            }),
          ),
      );

      expect(error).toMatchObject({
        code: "clickhouse_system_identity_absent",
        operation: "insert",
        httpStatus: 500,
        fault: "platform",
      });
      expect(error).toBeInstanceOf(HandledError);
    });
  });
});
