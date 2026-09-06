/** @vitest-environment node */

/**
 * The write path against two mutually isolated ClickHouse endpoints, on the
 * schema the shipped migrations put on each: this proves what the span
 * projection and the event store WROTE. specs/private-dataplane/data-isolation
 */
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import {
  ClickHouseClientFactory,
  ClickHouseConfigService,
  ClickHouseConnection,
  ClickHouseMigrateTask,
  createTenantRouter,
  DEFAULT_CLICKHOUSE_SETTINGS,
  parseRoutingTable,
  PRIVATE_ROUTE_ENV_PREFIX,
  type ClickHouseClientCreationInput,
  type TenantDirectory,
} from "@langwatch/clickhouse-client";
import { createEventingRetentionConfiguration } from "@langwatch/eventing/server";
import { EventingClickHouseEventRepository } from "@langwatch/eventing/server";
import type { SpanInsertData } from "@langwatch/trace-contract";
import {
  migrateTestClickHouseOnce,
  privateRouteOrgId,
  startTestClickHouseEndpoints,
} from "@langwatch/test-harness";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SpanStorageClickHouseRepository } from "../span-storage.repository";

const PRIVATE_ORGANIZATION = privateRouteOrgId("isolation-private");
const SHARED_ORGANIZATION = privateRouteOrgId("isolation-shared");
const PRIVATE_PROJECT = `proj-private-${nanoid(8)}`;
const SHARED_PROJECT = `proj-shared-${nanoid(8)}`;

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

function spanFor(tenantId: string, spanId: string): SpanInsertData {
  const now = Date.now();
  return {
    id: `projection-${nanoid(8)}`,
    tenantId,
    traceId: `trace-${nanoid(8)}`,
    spanId,
    parentSpanId: null,
    parentTraceId: null,
    parentIsRemote: null,
    sampled: true,
    startTimeUnixMs: now - 100,
    endTimeUnixMs: now,
    durationMs: 100,
    name: "isolation-span",
    kind: 1,
    resourceAttributes: {},
    spanAttributes: { "service.name": "isolation" },
    statusCode: null,
    statusMessage: null,
    instrumentationScope: { name: "test", version: null },
    events: [],
    links: [],
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    cost: null,
    nonBilledCost: null,
    retentionDays: 0,
  };
}

function eventFor(tenantId: string, eventId: string) {
  const now = Date.now();
  return {
    TenantId: tenantId,
    AggregateType: "trace",
    AggregateId: `agg-${nanoid(8)}`,
    EventId: eventId,
    EventTimestamp: now,
    EventOccurredAt: now,
    EventType: "TraceIngested",
    EventVersion: "1",
    EventPayload: { isolation: true },
    ProcessingTraceparent: "",
    IdempotencyKey: `idem-${nanoid(8)}`,
  };
}

async function spanIdsOn(
  client: ClickHouseClient,
  { tenantId, spanId }: { tenantId: string; spanId: string },
): Promise<string[]> {
  const result = await client.query({
    query: `SELECT SpanId FROM stored_spans
            WHERE TenantId = {tenantId:String} AND SpanId = {spanId:String}`,
    query_params: { tenantId, spanId },
    format: "JSONEachRow",
  });
  return (await result.json<{ SpanId: string }>()).map((row) => row.SpanId);
}

async function eventIdsOn(
  client: ClickHouseClient,
  { tenantId, eventId }: { tenantId: string; eventId: string },
): Promise<string[]> {
  const result = await client.query({
    query: `SELECT EventId FROM event_log
            WHERE TenantId = {tenantId:String} AND EventId = {eventId:String}`,
    query_params: { tenantId, eventId },
    format: "JSONEachRow",
  });
  return (await result.json<{ EventId: string }>()).map((row) => row.EventId);
}

let sharedProbe: ClickHouseClient;
let privateProbe: ClickHouseClient;
let connection: ClickHouseConnection<ClickHouseClient & { close(): Promise<void> }>;
let spans: SpanStorageClickHouseRepository;
let events: EventingClickHouseEventRepository;

describe("given one organization on a private ClickHouse instance and one on the shared instance", () => {
  beforeAll(async () => {
    const [shared, isolated] = await startTestClickHouseEndpoints({
      suite: "ch-isolation",
      names: ["shared", "private"],
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
              },
            }).execute();
          } finally {
            if (previousCluster !== undefined) process.env.CLICKHOUSE_CLUSTER = previousCluster;
          }
        },
      });
    }

    const table = parseRoutingTable({
      [`${PRIVATE_ROUTE_ENV_PREFIX}acme__${PRIVATE_ORGANIZATION}`]: isolated.url,
    });
    const configuration = ClickHouseConfigService.create().resolve({
      shared: { url: shared.url, cluster: "test" },
      privateRoutes: [...table.routes].map(([organizationId, url]) => ({
        organizationId,
        url,
        cluster: "test",
      })),
    });
    connection = ClickHouseConnection.create({
      configuration,
      router: createTenantRouter({ table, directory }),
      clientFactory: new VendorFactory(),
    });

    const resolveClient = (tenantId: string) => connection.resolve(tenantId);
    spans = new SpanStorageClickHouseRepository(resolveClient as never);
    events = EventingClickHouseEventRepository.create({
      resolveClient: resolveClient as never,
      retention: createEventingRetentionConfiguration({ defaultRetentionDays: 30 }),
    });

    sharedProbe = createClient({ url: shared.url });
    privateProbe = createClient({ url: isolated.url });
  }, 600_000);

  afterAll(async () => {
    await connection?.closeOnce();
    await Promise.all([sharedProbe?.close(), privateProbe?.close()]);
  }, 60_000);

  describe("when a span is ingested for the private-instance organization", () => {
    /** @scenario "Spans for a private-CH org go to the private instance only" */
    /** @scenario "A repository handed the routed connection cannot reach the other instance" */
    it("stores the span on the private instance and nowhere else", async () => {
      const spanId = `private-span-${nanoid(8)}`;
      await spans.insertSpan(spanFor(PRIVATE_PROJECT, spanId));

      expect(await spanIdsOn(privateProbe, { tenantId: PRIVATE_PROJECT, spanId })).toEqual([
        spanId,
      ]);
      expect(await spanIdsOn(sharedProbe, { tenantId: PRIVATE_PROJECT, spanId })).toEqual([]);
    });
  });

  describe("when a span is ingested for the shared-instance organization", () => {
    /** @scenario "Spans for a shared-CH org go to the shared instance only" */
    it("stores the span on the shared instance and nowhere else", async () => {
      const spanId = `shared-span-${nanoid(8)}`;
      await spans.insertSpan(spanFor(SHARED_PROJECT, spanId));

      expect(await spanIdsOn(sharedProbe, { tenantId: SHARED_PROJECT, spanId })).toEqual([spanId]);
      expect(await spanIdsOn(privateProbe, { tenantId: SHARED_PROJECT, spanId })).toEqual([]);
    });
  });

  describe("when events are stored for the private-instance organization", () => {
    /** @scenario "Events for a private-CH org are stored in the private instance" */
    it("stores the event log rows on the private instance and nowhere else", async () => {
      const eventId = `private-event-${nanoid(8)}`;
      await events.insertEventRecords([eventFor(PRIVATE_PROJECT, eventId)]);

      expect(await eventIdsOn(privateProbe, { tenantId: PRIVATE_PROJECT, eventId })).toEqual([
        eventId,
      ]);
      expect(await eventIdsOn(sharedProbe, { tenantId: PRIVATE_PROJECT, eventId })).toEqual([]);
    });
  });

  describe("when spans are ingested concurrently for both organizations", () => {
    /** @scenario "Concurrent writes for different orgs route correctly" */
    it("routes each write to its own instance", async () => {
      const privateSpanId = `concurrent-private-${nanoid(8)}`;
      const sharedSpanId = `concurrent-shared-${nanoid(8)}`;

      await Promise.all([
        spans.insertSpan(spanFor(PRIVATE_PROJECT, privateSpanId)),
        spans.insertSpan(spanFor(SHARED_PROJECT, sharedSpanId)),
      ]);

      expect(
        await spanIdsOn(privateProbe, { tenantId: PRIVATE_PROJECT, spanId: privateSpanId }),
      ).toEqual([privateSpanId]);
      expect(
        await spanIdsOn(sharedProbe, { tenantId: PRIVATE_PROJECT, spanId: privateSpanId }),
      ).toEqual([]);

      expect(
        await spanIdsOn(sharedProbe, { tenantId: SHARED_PROJECT, spanId: sharedSpanId }),
      ).toEqual([sharedSpanId]);
      expect(
        await spanIdsOn(privateProbe, { tenantId: SHARED_PROJECT, spanId: sharedSpanId }),
      ).toEqual([]);
    });
  });
});
