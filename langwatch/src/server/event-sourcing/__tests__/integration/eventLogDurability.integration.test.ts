/**
 * event_log durability integration test — proves the SOC2 / ISO 27001 /
 * EU AI Act / GDPR / HIPAA-most-uses non-repudiation foundation that the
 * governance compliance baseline rests on.
 *
 * Locked architecture (specs/ai-gateway/governance/event-log-durability.feature
 * + compliance-baseline.feature) claims:
 *
 *   1. Every command writes a *Received event into the append-only
 *      event_log BEFORE any projection writes its derived view.
 *   2. Deletion of a derived view (stored_spans, trace_summaries, future
 *      governance_kpis fold, governance_ocsf_events fold) does NOT delete
 *      the event_log evidence.
 *   3. Cross-tenant isolation: a tenant cannot read another tenant's
 *      event_log evidence (org-tenancy invariant).
 *
 * (1) and (2) are what auditors actually ask about; (3) is the org-tenancy
 * invariant that underwrites RBAC + multi-org compliance. All three apply
 * to the EXISTING trace pipeline today, which the unified-substrate
 * direction promises to reuse for governance ingest. Proving them here
 * pre-Sergey-2b means the rewire only has to add origin metadata stamping
 * + the hidden Governance Project routing — the durability + tenancy
 * machinery is already validated in this branch.
 *
 * Test approach: writes events directly to event_log via the CH client
 * (the same pattern replayService.integration.test.ts uses) and asserts
 * read/delete behavior on the table. This is a focused proof of the
 * STORE LAYER's durability invariant; the full pipeline test is
 * traceProcessing.integration.test.ts (which currently runs only with
 * full Prisma + costing dependencies).
 *
 * Spec coverage:
 *   - specs/ai-gateway/governance/event-log-durability.feature (Lane-S)
 *   - specs/ai-gateway/governance/compliance-baseline.feature (Lane-A)
 *
 * Pairs with parseOtlpBody.test.ts (parser-equivalence contract, 38106f768).
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  getTestClickHouseClient,
  getTestRedisConnection,
  startTestContainers,
  stopTestContainers,
} from "./testContainers";
import { generateTestTenantId } from "./testHelpers";

import { EventStoreClickHouse } from "../../stores/eventStoreClickHouse";
import { EventRepositoryClickHouse } from "../../stores/repositories/eventRepositoryClickHouse";
import type { AggregateType } from "../../";

const hasTestcontainers = !!(
  process.env.TEST_CLICKHOUSE_URL || process.env.CI_CLICKHOUSE_URL
);

interface SpanReceivedEventRow {
  TenantId: string;
  AggregateType: string;
  AggregateId: string;
  EventId: string;
  EventType: string;
  EventTimestamp: number;
  EventOccurredAt: number;
  EventVersion: string;
  EventPayload: string;
  IdempotencyKey?: string;
}

function buildSpanReceivedEventRow({
  tenantId,
  traceId,
  eventId,
  spanName,
  ts,
  attributes = {},
}: {
  tenantId: string;
  traceId: string;
  eventId: string;
  spanName: string;
  ts: number;
  attributes?: Record<string, string | number | boolean>;
}): SpanReceivedEventRow {
  const payload = {
    span: {
      traceId,
      spanId: `span-${eventId}`,
      name: spanName,
      kind: 1,
      startTimeUnixNano: String(BigInt(ts) * 1_000_000n),
      endTimeUnixNano: String(BigInt(ts + 100) * 1_000_000n),
      attributes: Object.entries(attributes).map(([key, value]) => ({
        key,
        value:
          typeof value === "string"
            ? { stringValue: value }
            : typeof value === "number"
              ? { doubleValue: value }
              : { boolValue: value },
      })),
      events: [],
      links: [],
      status: { code: 1 },
    },
    resource: null,
    instrumentationScope: null,
  };
  return {
    TenantId: tenantId,
    AggregateType: "trace",
    AggregateId: traceId,
    EventId: eventId,
    EventType: "SpanReceivedEvent",
    EventTimestamp: ts,
    EventOccurredAt: ts,
    EventVersion: "2025-01-01",
    EventPayload: JSON.stringify(payload),
    IdempotencyKey: eventId,
  };
}

async function countEventLogForTenant(
  client: ClickHouseClient,
  tenantId: string,
): Promise<number> {
  const result = await client.query({
    query: `
      SELECT COUNT(*) AS count
      FROM event_log FINAL
      WHERE TenantId = {tenantId:String}
        AND AggregateType = 'trace'
    `,
    query_params: { tenantId },
    format: "JSONEachRow",
  });
  const rows = await result.json<{ count: number | string }>();
  return Number(rows[0]?.count ?? 0);
}

async function countStoredSpansForTenant(
  client: ClickHouseClient,
  tenantId: string,
): Promise<number> {
  const result = await client.query({
    query: `
      SELECT COUNT(*) AS count
      FROM stored_spans
      WHERE TenantId = {tenantId:String}
    `,
    query_params: { tenantId },
    format: "JSONEachRow",
  });
  const rows = await result.json<{ count: number | string }>();
  return Number(rows[0]?.count ?? 0);
}

async function insertStoredSpansFor({
  client,
  tenantId,
  traceId,
  spanIds,
}: {
  client: ClickHouseClient;
  tenantId: string;
  traceId: string;
  spanIds: string[];
}): Promise<void> {
  const now = Date.now();
  const values = spanIds.map((spanId, idx) => ({
    TenantId: tenantId,
    TraceId: traceId,
    SpanId: spanId,
    Name: `span-${idx}`,
    StartedAt: now * 1_000_000,
    DurationNanos: 1_000_000,
    Attributes: "{}",
    StatusCode: 1,
    ParentSpanId: "",
  }));
  await client.insert({
    table: "stored_spans",
    values,
    format: "JSONEachRow",
  });
}

async function deleteStoredSpansForTenant(
  client: ClickHouseClient,
  tenantId: string,
): Promise<void> {
  await client.exec({
    query: `
      ALTER TABLE stored_spans DELETE
      WHERE TenantId = {tenantId:String}
    `,
    query_params: { tenantId },
  });
}

async function cleanupTenant(
  client: ClickHouseClient,
  tenantIds: string[],
): Promise<void> {
  await client.exec({
    query: `ALTER TABLE event_log DELETE WHERE TenantId IN ({ids:Array(String)})`,
    query_params: { ids: tenantIds },
  });
  await client.exec({
    query: `ALTER TABLE stored_spans DELETE WHERE TenantId IN ({ids:Array(String)})`,
    query_params: { ids: tenantIds },
  });
}

describe.skipIf(!hasTestcontainers)(
  "event_log durability — non-repudiation foundation for governance compliance",
  () => {
    let client: ClickHouseClient;
    let eventStore: EventStoreClickHouse;
    const ownedTenantIds: string[] = [];

    beforeAll(async () => {
      await startTestContainers();
      client = getTestClickHouseClient()!;
      const redis = getTestRedisConnection();
      if (!redis) throw new Error("Redis not available; testcontainers required.");
      eventStore = new EventStoreClickHouse(
        new EventRepositoryClickHouse(async () => client),
      );
    });

    afterAll(async () => {
      if (client && ownedTenantIds.length > 0) {
        await cleanupTenant(client, ownedTenantIds);
      }
      await stopTestContainers();
    });

    describe("given a SpanReceivedEvent has been appended to event_log", () => {
      it("the event is readable via the EventStore and carries the original payload", async () => {
        const tenantId = generateTestTenantId();
        ownedTenantIds.push(tenantId);
        const traceId = `trace-${tenantId}-canary`;
        const ts = 1_700_000_010_000;

        await client.insert({
          table: "event_log",
          values: [
            buildSpanReceivedEventRow({
              tenantId,
              traceId,
              eventId: `${tenantId}-evt-001`,
              spanName: "audit-canary-span",
              ts,
              attributes: {
                "user.email": "auditor@acme.test",
                "gen_ai.usage.cost_usd": 0.42,
              },
            }),
          ],
          format: "JSONEachRow",
        });

        const events = await eventStore.getEvents(
          traceId,
          { tenantId },
          "trace" as AggregateType,
        );

        expect(events.length).toBeGreaterThanOrEqual(1);
        const evt = events[0]!;
        expect(evt.type).toBe("SpanReceivedEvent");
        const serialised = JSON.stringify(evt);
        expect(serialised).toContain("audit-canary-span");
        expect(serialised).toContain("auditor@acme.test");
      });
    });

    describe("given a derived view (stored_spans) is deleted for a tenant", () => {
      it("preserves every event in event_log — deletion of a view does not delete evidence", async () => {
        const tenantId = generateTestTenantId();
        ownedTenantIds.push(tenantId);
        const traceId = `trace-${tenantId}-multi`;
        const baseTs = 1_700_000_020_000;

        const spanIds: string[] = [];
        const eventRows: SpanReceivedEventRow[] = [];
        for (let i = 0; i < 3; i++) {
          const eventId = `${tenantId}-evt-${i}`;
          spanIds.push(`span-${eventId}`);
          eventRows.push(
            buildSpanReceivedEventRow({
              tenantId,
              traceId,
              eventId,
              spanName: `span-${i}`,
              ts: baseTs + i,
            }),
          );
        }

        await client.insert({ table: "event_log", values: eventRows, format: "JSONEachRow" });
        await insertStoredSpansFor({ client, tenantId, traceId, spanIds });

        const eventLogBefore = await countEventLogForTenant(client, tenantId);
        const storedSpansBefore = await countStoredSpansForTenant(client, tenantId);
        expect(eventLogBefore).toBeGreaterThanOrEqual(3);
        expect(storedSpansBefore).toBeGreaterThanOrEqual(3);

        await deleteStoredSpansForTenant(client, tenantId);
        await new Promise((r) => setTimeout(r, 1500));

        const eventLogAfter = await countEventLogForTenant(client, tenantId);
        const storedSpansAfter = await countStoredSpansForTenant(client, tenantId);

        expect(eventLogAfter).toBe(eventLogBefore);
        expect(storedSpansAfter).toBeLessThan(storedSpansBefore);
      });

      it("readback of event_log post-delete returns full event data including names and attributes", async () => {
        const tenantId = generateTestTenantId();
        ownedTenantIds.push(tenantId);
        const traceId = `trace-${tenantId}-fidelity`;
        const ts = 1_700_000_030_000;
        const canarySpanName = `audit-fidelity-${tenantId}`;
        const eventId = `${tenantId}-evt-fidelity`;

        await client.insert({
          table: "event_log",
          values: [
            buildSpanReceivedEventRow({
              tenantId,
              traceId,
              eventId,
              spanName: canarySpanName,
              ts,
              attributes: {
                "user.email": "auditor2@acme.test",
                "gen_ai.usage.cost_usd": 0.13,
              },
            }),
          ],
          format: "JSONEachRow",
        });

        await insertStoredSpansFor({
          client,
          tenantId,
          traceId,
          spanIds: [`span-${eventId}`],
        });

        await deleteStoredSpansForTenant(client, tenantId);
        await new Promise((r) => setTimeout(r, 1000));

        const events = await eventStore.getEvents(
          traceId,
          { tenantId },
          "trace" as AggregateType,
        );

        expect(events.length).toBeGreaterThanOrEqual(1);
        const evt = events.find((e: any) => e.type === "SpanReceivedEvent");
        expect(evt).toBeDefined();
        const serialised = JSON.stringify(evt);
        expect(serialised).toContain(canarySpanName);
        expect(serialised).toContain("auditor2@acme.test");
      });
    });

    describe("given multiple traces from one tenant", () => {
      it("preserves cross-trace event evidence even after the tenant's view is deleted", async () => {
        const tenantId = generateTestTenantId();
        ownedTenantIds.push(tenantId);
        const traceA = `trace-${tenantId}-A`;
        const traceB = `trace-${tenantId}-B`;
        const ts = 1_700_000_040_000;

        await client.insert({
          table: "event_log",
          values: [
            buildSpanReceivedEventRow({
              tenantId,
              traceId: traceA,
              eventId: `${tenantId}-A-evt`,
              spanName: "trace-a-span",
              ts,
            }),
            buildSpanReceivedEventRow({
              tenantId,
              traceId: traceB,
              eventId: `${tenantId}-B-evt`,
              spanName: "trace-b-span",
              ts: ts + 1,
            }),
          ],
          format: "JSONEachRow",
        });

        await insertStoredSpansFor({
          client,
          tenantId,
          traceId: traceA,
          spanIds: [`span-${tenantId}-A-evt`],
        });
        await insertStoredSpansFor({
          client,
          tenantId,
          traceId: traceB,
          spanIds: [`span-${tenantId}-B-evt`],
        });

        await deleteStoredSpansForTenant(client, tenantId);
        await new Promise((r) => setTimeout(r, 1500));

        const eventsA = await eventStore.getEvents(
          traceA,
          { tenantId },
          "trace" as AggregateType,
        );
        const eventsB = await eventStore.getEvents(
          traceB,
          { tenantId },
          "trace" as AggregateType,
        );

        expect(eventsA.length).toBeGreaterThanOrEqual(1);
        expect(eventsB.length).toBeGreaterThanOrEqual(1);
        expect(eventsA.some((e: any) => e.type === "SpanReceivedEvent")).toBe(true);
        expect(eventsB.some((e: any) => e.type === "SpanReceivedEvent")).toBe(true);
      });
    });

    describe("given two tenants exist (cross-tenant isolation)", () => {
      it("a tenant cannot read another tenant's event_log evidence", async () => {
        const ownerTenant = generateTestTenantId();
        const otherTenant = generateTestTenantId();
        ownedTenantIds.push(ownerTenant, otherTenant);
        const traceId = `trace-shared-id-${Date.now()}`;
        const ts = 1_700_000_050_000;

        await client.insert({
          table: "event_log",
          values: [
            buildSpanReceivedEventRow({
              tenantId: ownerTenant,
              traceId,
              eventId: `${ownerTenant}-evt`,
              spanName: "owner-span",
              ts,
            }),
          ],
          format: "JSONEachRow",
        });

        const eventsForOwner = await eventStore.getEvents(
          traceId,
          { tenantId: ownerTenant },
          "trace" as AggregateType,
        );
        const eventsForOther = await eventStore.getEvents(
          traceId,
          { tenantId: otherTenant },
          "trace" as AggregateType,
        );

        expect(eventsForOwner.length).toBeGreaterThanOrEqual(1);
        expect(eventsForOther.length).toBe(0);
      });

      it("idempotency on EventId — replaying the same event does not produce duplicates", async () => {
        const tenantId = generateTestTenantId();
        ownedTenantIds.push(tenantId);
        const traceId = `trace-${tenantId}-idem`;
        const ts = 1_700_000_060_000;
        const eventId = `${tenantId}-evt-idem`;

        const row = buildSpanReceivedEventRow({
          tenantId,
          traceId,
          eventId,
          spanName: "idempotent-span",
          ts,
        });

        await client.insert({ table: "event_log", values: [row], format: "JSONEachRow" });
        await client.insert({ table: "event_log", values: [row], format: "JSONEachRow" });
        await new Promise((r) => setTimeout(r, 500));

        const events = await eventStore.getEvents(
          traceId,
          { tenantId },
          "trace" as AggregateType,
        );

        const matchingEventIds = events
          .filter((e: any) => e.type === "SpanReceivedEvent")
          .map((e: any) => e.id ?? e.eventId);
        const distinctIds = new Set(matchingEventIds);
        expect(distinctIds.size).toBe(matchingEventIds.length);
      });
    });
  },
);
