/** @vitest-environment node */

/**
 * Log rows against two mutually isolated ClickHouse endpoints, written and read
 * through the routed `clickhouse` member the process hands this repository.
 * specs/private-dataplane/data-isolation.feature
 */
import { randomUUID } from "node:crypto";

import { type ClickHouseClient, createClient } from "@clickhouse/client";
import {
  ClickHouseClientFactory,
  ClickHouseConfigService,
  ClickHouseConnection,
  ClickHouseQueryClient,
  createTenantRouter,
  DEFAULT_CLICKHOUSE_SETTINGS,
  isTransientClickHouseError,
  parseRoutingTable,
  PRIVATE_ROUTE_ENV_PREFIX,
  routingDriver,
  type ClickHouseClientCreationInput,
  type TenantDirectory,
  TenantGuard,
} from "@langwatch/clickhouse-client";
import {
  migrateTestClickHouseOnce,
  privateRouteOrgId,
  startTestClickHouseEndpoints,
} from "@langwatch/clickhouse-client/testing";
import { ClickHouseMigrateTask } from "@langwatch/clickhouse-migrations";
import type { CanonicalLogRecord } from "@langwatch/log-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ClickHouseCanonicalLogRecordAppendRepository } from "../clickhouse.canonical-log-record-append.repository.ts";

const PRIVATE_ORGANIZATION = privateRouteOrgId("log-isolation-private");
const SHARED_ORGANIZATION = privateRouteOrgId("log-isolation-shared");
const PRIVATE_PROJECT = `proj-private-${randomUUID()}`;
const SHARED_PROJECT = `proj-shared-${randomUUID()}`;
/** Nothing listens on the discard port, so a statement routed here is refused at connect. */
const UNREACHABLE_URL = "http://127.0.0.1:9";

const directory: TenantDirectory = {
  organizationForTenant: async (tenantId) =>
    ({
      [PRIVATE_PROJECT]: PRIVATE_ORGANIZATION,
      [SHARED_PROJECT]: SHARED_ORGANIZATION,
    })[tenantId] ?? null,
};

class VendorFactory extends ClickHouseClientFactory<ClickHouseClient & { close(): Promise<void> }> {
  create(input: ClickHouseClientCreationInput): ClickHouseClient & { close(): Promise<void> } {
    return createClient({
      url: input.url,
      max_open_connections: input.maxOpenConnections,
      clickhouse_settings: {
        ...DEFAULT_CLICKHOUSE_SETTINGS,
        date_time_input_format: "best_effort",
      },
    });
  }
}

function routedMember({ sharedUrl, privateUrl }: { sharedUrl: string; privateUrl: string }) {
  const table = parseRoutingTable({
    [`${PRIVATE_ROUTE_ENV_PREFIX}acme__${PRIVATE_ORGANIZATION}`]: privateUrl,
  });
  const configuration = ClickHouseConfigService.create().resolve({
    shared: { url: sharedUrl, cluster: "test" },
    privateRoutes: [...table.routes].map(([organizationId, url]) => ({
      organizationId,
      url,
      cluster: "test",
    })),
  });
  const connection = ClickHouseConnection.create({
    configuration,
    router: createTenantRouter({ table, directory }),
    clientFactory: new VendorFactory(),
  });
  const clickhouse = new ClickHouseQueryClient({
    tenantGuard: new TenantGuard(),
    driver: routingDriver(connection),
  });
  const logs = ClickHouseCanonicalLogRecordAppendRepository.create({
    resolveClient: ClickHouseCanonicalLogRecordAppendRepository.resolverOver(clickhouse),
    defaultRetentionDays: 30,
  });
  return { connection, clickhouse, logs };
}

function newRecordId(): string {
  return randomUUID().replaceAll("-", "").padEnd(64, "0");
}

function recordFor({
  tenantId,
  organizationId,
  recordId,
}: {
  tenantId: string;
  organizationId: string;
  recordId: string;
}): CanonicalLogRecord {
  const now = Date.now();
  return {
    tenantId,
    organizationId,
    recordId,
    resourceSchemaUrl: "",
    resourceAttributesJson: "[]",
    resourceAttributesFlatJson: "{}",
    resourceAttributeKeys: [],
    resourceDroppedAttributesCount: 0,
    scopeSchemaUrl: "",
    scopeName: "scope",
    scopeVersion: "1",
    scopeAttributesJson: "[]",
    scopeAttributeKeys: [],
    scopeDroppedAttributesCount: 0,
    wireTraceId: "",
    wireSpanId: "",
    correlationTraceId: "b".repeat(32),
    correlationSpanId: "c".repeat(16),
    correlationSource: "claude_synthesized",
    timeUnixNano: String(BigInt(now) * 1_000_000n),
    observedTimeUnixNano: "0",
    timeUnixMs: now,
    severityNumber: 9,
    severityText: "INFO",
    bodyType: "string",
    bodyJson: '{"type":"string","value":"isolation"}',
    bodyText: "isolation",
    attributesJson: "[]",
    attributesFlatJson: "{}",
    attributeKeys: [],
    droppedAttributesCount: 0,
    flags: 0,
    eventName: "api_request",
    providerKind: "claude_code",
    providerEventKind: "model",
    providerEventSequence: "1",
    providerSessionId: "session",
    providerConversationId: "",
    providerPromptId: "prompt",
    piiRedactionLevel: "ESSENTIAL",
    canonicalPayload: "{}",
    canonicalSizeBytes: 2,
    occurredAt: now,
    acceptedAt: now,
  };
}

async function recordIdsOn(
  client: ClickHouseClient,
  { table, tenantId, recordId }: { table: string; tenantId: string; recordId: string },
): Promise<string[]> {
  const result = await client.query({
    query: `SELECT RecordId FROM ${table}
            WHERE TenantId = {tenantId:String} AND RecordId = {recordId:String}`,
    query_params: { tenantId, recordId },
    format: "JSONEachRow",
  });
  return (await result.json<{ RecordId: string }>()).map((row) => row.RecordId);
}

let sharedProbe: ClickHouseClient;
let privateProbe: ClickHouseClient;
let routed: ReturnType<typeof routedMember>;
let down: ReturnType<typeof routedMember>;

describe("given one organization on a private ClickHouse instance and one on the shared instance", () => {
  beforeAll(async () => {
    const [shared, isolated] = await startTestClickHouseEndpoints({
      suite: "ch-log-isolation",
      names: ["shared", "private"],
      environment: process.env,
    });
    if (!shared || !isolated) throw new Error("Two ClickHouse endpoints were not provisioned");

    for (const endpoint of [shared, isolated]) {
      await migrateTestClickHouseOnce({
        url: endpoint.url,
        migrate: async () => {
          // CLICKHOUSE_CLUSTER switches every engine to its Replicated form,
          // which needs a Keeper no test server has.
          const previousCluster = process.env.CLICKHOUSE_CLUSTER;
          delete process.env.CLICKHOUSE_CLUSTER;
          try {
            await ClickHouseMigrateTask.createFromConfig({
              config: {
                buildTime: false,
                skipped: false,
                sharedUrl: endpoint.url,
                privateEndpoints: [],
                settings: {
                  coldStorageEnabled: false,
                  hotDayOverrides: {},
                  childEnvironment: { PATH: process.env.PATH, HOME: process.env.HOME },
                },
              },
            }).execute();
          } finally {
            if (previousCluster !== undefined) process.env.CLICKHOUSE_CLUSTER = previousCluster;
          }
        },
      });
    }

    routed = routedMember({ sharedUrl: shared.url, privateUrl: isolated.url });
    down = routedMember({ sharedUrl: shared.url, privateUrl: UNREACHABLE_URL });
    sharedProbe = createClient({ url: shared.url });
    privateProbe = createClient({ url: isolated.url });
  }, 600_000);

  afterAll(async () => {
    await Promise.all([routed?.connection.closeOnce(), down?.connection.closeOnce()]);
    await Promise.all([sharedProbe?.close(), privateProbe?.close()]);
  }, 60_000);

  describe("when a log record is written for the private-instance organization", () => {
    /** @scenario "Log records for a private-CH org land in the private instance only" */
    it("stores the record and its usage estimate on the private instance and nowhere else", async () => {
      const recordId = newRecordId();
      await routed.logs.ensureLogRecord(
        recordFor({ tenantId: PRIVATE_PROJECT, organizationId: PRIVATE_ORGANIZATION, recordId }),
      );

      for (const table of ["log_records", "log_usage_estimates"]) {
        const where = { table, tenantId: PRIVATE_PROJECT, recordId };
        expect(await recordIdsOn(privateProbe, where)).toEqual([recordId]);
        expect(await recordIdsOn(sharedProbe, where)).toEqual([]);
      }
    });
  });

  describe("when the private-instance organization reads its log records", () => {
    /** @scenario "Log reads for a private-CH org come from the private instance only" */
    it("returns the record held only on the private instance", async () => {
      const recordId = newRecordId();
      await routed.logs.ensureLogRecord(
        recordFor({ tenantId: PRIVATE_PROJECT, organizationId: PRIVATE_ORGANIZATION, recordId }),
      );
      const where = { table: "log_records", tenantId: PRIVATE_PROJECT, recordId };
      expect(await recordIdsOn(sharedProbe, where)).toEqual([]);

      const read = await routed.clickhouse.query<{ RecordId: string }>({
        tenantId: PRIVATE_PROJECT,
        sql: `SELECT RecordId FROM log_records
              WHERE TenantId = {tenantId:String} AND RecordId = {recordId:String}`,
        params: { tenantId: PRIVATE_PROJECT, recordId },
      });

      expect(read.rows.map((row) => row.RecordId)).toEqual([recordId]);
    });
  });

  describe("when the shared-instance organization reads by the private organization's record id", () => {
    /** @scenario "Another org's log reads never see a private-CH org's records" */
    it("returns nothing", async () => {
      const recordId = newRecordId();
      await routed.logs.ensureLogRecord(
        recordFor({ tenantId: PRIVATE_PROJECT, organizationId: PRIVATE_ORGANIZATION, recordId }),
      );

      // Routed as the shared project, naming the private one: the shared route must not reach it.
      const read = await routed.clickhouse.query<{ RecordId: string }>({
        tenantId: SHARED_PROJECT,
        sql: `SELECT RecordId FROM log_records
              WHERE TenantId = {tenantId:String} AND RecordId = {recordId:String}`,
        params: { tenantId: PRIVATE_PROJECT, recordId },
      });

      expect(read.rows).toEqual([]);
    });
  });

  describe("when the private instance is unreachable", () => {
    /** @scenario "Log writes for a private-CH org fail retryably while its private instance is down" */
    it("fails the private write transiently, writes nothing shared, and still serves the shared organization", async () => {
      const privateRecordId = newRecordId();
      const sharedRecordId = newRecordId();

      await expect(
        down.logs.ensureLogRecord(
          recordFor({
            tenantId: PRIVATE_PROJECT,
            organizationId: PRIVATE_ORGANIZATION,
            recordId: privateRecordId,
          }),
        ),
      ).rejects.toSatisfy((error) => isTransientClickHouseError({ error }));
      for (const table of ["log_records", "log_usage_estimates"]) {
        expect(
          await recordIdsOn(sharedProbe, {
            table,
            tenantId: PRIVATE_PROJECT,
            recordId: privateRecordId,
          }),
        ).toEqual([]);
      }

      await down.logs.ensureLogRecord(
        recordFor({
          tenantId: SHARED_PROJECT,
          organizationId: SHARED_ORGANIZATION,
          recordId: sharedRecordId,
        }),
      );
      expect(
        await recordIdsOn(sharedProbe, {
          table: "log_records",
          tenantId: SHARED_PROJECT,
          recordId: sharedRecordId,
        }),
      ).toEqual([sharedRecordId]);
    });
  });
});
