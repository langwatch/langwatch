/**
 * @vitest-environment node
 * @integration
 *
 * Verifies the `afterKey` predicate on getMarkedClaudeCodeLogsByTrace: fetching
 * strictly after a `(TimeUnixMs, event.sequence)` order key returns only records
 * after that key, in the ORDER BY order, so the span-sync reactor can page a
 * turn one bounded batch at a time (incremental conversion). Records that share
 * a millisecond are disambiguated by event.sequence exactly as the ORDER BY does.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../../event-sourcing/__tests__/integration/testContainers";
import { CLAUDE_CODE_KIND_ATTR } from "../../claude-code-log-to-span";
import { LogRecordStorageClickHouseRepository } from "../log-record-storage.clickhouse.repository";

let ch: ClickHouseClient;
let repo: LogRecordStorageClickHouseRepository;
const tag = nanoid();

// Insert a marked claude_code log at `now64(3) - agoSec` with a set event.sequence,
// so the rows stay inside the short retention floor and carry the sequence the
// afterKey tuple compares on.
async function insertMarkedLog({
  tenantId,
  traceId,
  spanId,
  agoSec,
  sequence,
}: {
  tenantId: string;
  traceId: string;
  spanId: string;
  agoSec: number;
  sequence: number;
}) {
  await ch.command({
    query: `
      INSERT INTO stored_log_records
        (ProjectionId, TenantId, TraceId, SpanId, TimeUnixMs, SeverityNumber,
         SeverityText, Body, Attributes, ResourceAttributes, ScopeName,
         ScopeVersion, CreatedAt, UpdatedAt, _retention_days)
      VALUES
        ({pid:String}, {tenantId:String}, {traceId:String}, {spanId:String},
         now64(3) - {agoSec:UInt32}, 9, 'INFO', '{}',
         map('${CLAUDE_CODE_KIND_ATTR}', 'model', 'event.sequence', {seq:String}),
         map(), 'com.anthropic.claude_code.events', NULL, now64(3), now64(3), 30)
    `,
    query_params: {
      pid: `${tag}-${spanId}`,
      tenantId,
      traceId,
      spanId,
      agoSec,
      seq: String(sequence),
    },
  });
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  repo = new LogRecordStorageClickHouseRepository(async () => ch);
}, 60_000);

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query: `ALTER TABLE stored_log_records DELETE WHERE TenantId = {tenantId:String} AND startsWith(ProjectionId, {tag:String})`,
      query_params: { tenantId: `${tag}-project`, tag },
    });
  }
  await stopTestContainers();
});

describe("getMarkedClaudeCodeLogsByTrace afterKey paging", () => {
  const tenantId = `${tag}-project`;
  const traceId = `${tag}-trace`;

  beforeAll(async () => {
    // Three records, oldest -> newest. `a` and `b` sit at distinct seconds; `c`
    // is newest. Insertion order is intentionally shuffled to prove the query
    // orders, not the insert.
    await insertMarkedLog({ tenantId, traceId, spanId: `${tag}-b`, agoSec: 20, sequence: 2 });
    await insertMarkedLog({ tenantId, traceId, spanId: `${tag}-c`, agoSec: 10, sequence: 3 });
    await insertMarkedLog({ tenantId, traceId, spanId: `${tag}-a`, agoSec: 30, sequence: 1 });
  });

  describe("when no afterKey is supplied", () => {
    it("returns every marked record in (time, sequence) order", async () => {
      const rows = await repo.getMarkedClaudeCodeLogsByTrace(
        tenantId,
        traceId,
        Date.now(),
      );
      expect(rows.map((r) => r.spanId)).toEqual([
        `${tag}-a`,
        `${tag}-b`,
        `${tag}-c`,
      ]);
    });
  });

  describe("when an afterKey at the first record is supplied", () => {
    it("returns only the records strictly after it, still ordered", async () => {
      const all = await repo.getMarkedClaudeCodeLogsByTrace(
        tenantId,
        traceId,
        Date.now(),
      );
      const first = all[0]!;
      const rows = await repo.getMarkedClaudeCodeLogsByTrace(
        tenantId,
        traceId,
        Date.now(),
        undefined,
        { timeUnixMs: first.timeUnixMs, sequence: 1 },
      );
      // `a` (the cursor) is excluded; `b` and `c` remain in order.
      expect(rows.map((r) => r.spanId)).toEqual([`${tag}-b`, `${tag}-c`]);
    });
  });

  describe("when an afterKey at the last record is supplied", () => {
    it("returns no records (the turn is fully paged)", async () => {
      const all = await repo.getMarkedClaudeCodeLogsByTrace(
        tenantId,
        traceId,
        Date.now(),
      );
      const last = all[all.length - 1]!;
      const rows = await repo.getMarkedClaudeCodeLogsByTrace(
        tenantId,
        traceId,
        Date.now(),
        undefined,
        { timeUnixMs: last.timeUnixMs, sequence: 3 },
      );
      expect(rows).toEqual([]);
    });
  });

  describe("when a limit is combined with an afterKey", () => {
    it("pages the turn one bounded batch at a time", async () => {
      const all = await repo.getMarkedClaudeCodeLogsByTrace(
        tenantId,
        traceId,
        Date.now(),
      );

      // Batch 1: first record only.
      const batch1 = await repo.getMarkedClaudeCodeLogsByTrace(
        tenantId,
        traceId,
        Date.now(),
        1,
      );
      expect(batch1.map((r) => r.spanId)).toEqual([`${tag}-a`]);

      // Batch 2: strictly after batch 1's last, limit 1.
      const cursor1 = batch1[0]!;
      const batch2 = await repo.getMarkedClaudeCodeLogsByTrace(
        tenantId,
        traceId,
        Date.now(),
        1,
        { timeUnixMs: cursor1.timeUnixMs, sequence: 1 },
      );
      expect(batch2.map((r) => r.spanId)).toEqual([`${tag}-b`]);

      // The two batches together are the head of the full ordered set.
      expect([...batch1, ...batch2].map((r) => r.spanId)).toEqual(
        all.slice(0, 2).map((r) => r.spanId),
      );
    });
  });
});
