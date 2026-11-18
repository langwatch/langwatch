/** @vitest-environment node */

/**
 * ADR-202 Decided 31 on ClickHouse 26.8: eventing's aggregate read and its id-index bounds read
 * run as the app reader, enforcing, on the migrated schema. Tenant B reuses tenant A's aggregate
 * with other occurred times, so a row or a bound of B's in A's answer shows a leak.
 */
import { randomUUID } from "node:crypto";

import { TENANT_IDS_SETTING } from "@langwatch/clickhouse-client";
import {
  type MigratedAppReaderClickHouse,
  startMigratedAppReaderClickHouse,
} from "@langwatch/test-harness/clickhouse-app-reader";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EVENT_LOG_ID_INDEX } from "../../../tables/event-log-id-index.ts";
import { EventingClickHouseEventRepository } from "../event-repository.clickhouse.ts";

const RUN = randomUUID().slice(0, 8);
const A = `project_a_${RUN}`;
const B = `project_b_${RUN}`;
const TYPE = "trace";
const AGGREGATE = "agg-1";
const DAY_MS = 86_400_000;
const NOW = Date.now();
/** Each tenant's events occur on days of their own, so a span names the tenant it came from. */
const OCCURRED: Readonly<Record<string, readonly number[]>> = {
  [A]: [NOW - 3 * DAY_MS, NOW - DAY_MS],
  [B]: [NOW - 20 * DAY_MS, NOW - 10 * DAY_MS],
};

let db: MigratedAppReaderClickHouse;

function occurredOf(tenantId: string): readonly number[] {
  const occurred = OCCURRED[tenantId];
  if (!occurred) throw new Error(`No events are planned for ${tenantId}`);
  return occurred;
}

function events(tenantId: string) {
  return occurredOf(tenantId).map((occurredAt, index) => ({
    TenantId: tenantId,
    IdempotencyKey: `${AGGREGATE}-e${index}`,
    AggregateType: TYPE,
    AggregateId: AGGREGATE,
    EventId: `e${index}`,
    EventType: "lw.test.happened",
    EventVersion: "2026-11-18",
    EventTimestamp: 1_000 * (index + 1),
    EventPayload: JSON.stringify({ tenantId }),
    ProcessingTraceparent: "",
    EventOccurredAt: occurredAt,
    _retention_days: 30,
  }));
}

/** Every row's tenant in `table`, read raw as the reader: only the policy narrows it. */
async function tenantsTheReaderSees({
  table,
  tenantId,
}: {
  table: "event_log" | "event_log_id_index";
  tenantId: string;
}): Promise<string[]> {
  const { rows } = await db.readerDriver.execute<{ TenantId: string }>({
    tenantId,
    sql: `SELECT TenantId FROM ${table} WHERE TenantId IN ({tenants:Array(String)})`,
    params: { tenants: [A, B] },
    settings: { [TENANT_IDS_SETTING]: tenantId },
  });
  return rows.map((row) => row.TenantId);
}

beforeAll(async () => {
  db = await startMigratedAppReaderClickHouse({
    suite: "eventing-app-reader",
    indexes: [EVENT_LOG_ID_INDEX],
    environment: process.env,
  });
  for (const tenantId of [A, B]) {
    await db.system.insert({ tenantId, table: "event_log", rows: events(tenantId) });
  }
}, 300_000);

afterAll(async () => {
  await db?.close();
});

describe("eventing's event log read as the app reader on ClickHouse 26.8", () => {
  /** @scenario "An aggregate's events read as the app reader are the request's tenant's alone" */
  it("reads an aggregate's events, bounded by its index span, and none of another tenant's", async () => {
    const repository = EventingClickHouseEventRepository.createForEventReads({
      resolveClient: async () => ({
        read: (input) => db.reader.read(input),
        insert: async () => undefined,
      }),
      eventLogIndex: { reader: db.reader, readiness: { isReady: () => true } },
    });

    const records = await repository.getEventRecords({
      tenantId: A,
      aggregateType: TYPE,
      aggregateId: AGGREGATE,
    });

    expect(records.map((record) => record.EventOccurredAt)).toEqual(occurredOf(A));
    // The repository leaves a JSON payload as stored text.
    const payloadTenants = records.map(
      (record) => (JSON.parse(String(record.EventPayload)) as { tenantId: string }).tenantId,
    );
    expect(payloadTenants).toEqual([A, A]);
    expect(await tenantsTheReaderSees({ table: "event_log", tenantId: A })).toEqual([A, A]);
  });

  /** @scenario "The event log's id-index bounds read as the app reader come from the request's tenant alone" */
  it("reads the aggregate's id-index bounds from its own tenant's index rows alone", async () => {
    for (const tenantId of [A, B]) {
      const bounds = await db.reader.indexBounds({
        tenantId,
        index: "event_log_id_index",
        key: { AggregateType: [TYPE], AggregateId: [AGGREGATE] },
        timeFormat: "epoch_ms",
      });
      const occurred = occurredOf(tenantId);

      expect(bounds.n).toBeGreaterThan(0);
      expect({ fromMs: bounds.fromMs, toMs: bounds.toMs }).toEqual({
        fromMs: Math.min(...occurred),
        toMs: Math.max(...occurred),
      });
      expect(await tenantsTheReaderSees({ table: "event_log_id_index", tenantId })).toEqual([
        tenantId,
      ]);
    }
  });
});
