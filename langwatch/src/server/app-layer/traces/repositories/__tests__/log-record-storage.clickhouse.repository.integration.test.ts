/**
 * @vitest-environment node
 * @integration
 *
 * Verifies the TimeUnixMs partition hint on getMarkedClaudeCodeLogsByTrace:
 * the hinted read (and the unbounded fallback) return the same marked logs, so
 * adding the partition predicate is correctness-preserving while letting the
 * scan prune `stored_log_records` weekly partitions instead of cold-scanning S3.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLAUDE_CODE_KIND_ATTR } from "../../claude-code-log-to-span";
import { LogRecordStorageClickHouseRepository } from "../log-record-storage.clickhouse.repository";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../../event-sourcing/__tests__/integration/testContainers";

let ch: ClickHouseClient;
let repo: LogRecordStorageClickHouseRepository;
const tag = nanoid();

// A fixed turn time, so the assertions don't couple the container clock
// (now64) to the host clock (Date.now): both the inserted TimeUnixMs and the
// hint are derived from this constant.
const TURN_MS = 1_700_000_000_000;

async function insertMarkedLog(
  tenantId: string,
  traceId: string,
  spanId: string,
  timeMs: number,
  marked: boolean,
) {
  await ch.command({
    query: `
      INSERT INTO stored_log_records
        (ProjectionId, TenantId, TraceId, SpanId, TimeUnixMs, SeverityNumber,
         SeverityText, Body, Attributes, ResourceAttributes, ScopeName,
         ScopeVersion, CreatedAt, UpdatedAt, _retention_days)
      VALUES
        ({pid:String}, {tenantId:String}, {traceId:String}, {spanId:String},
         fromUnixTimestamp64Milli(toInt64({timeMs:String})), 9, 'INFO', '{}',
         ${marked ? `map('${CLAUDE_CODE_KIND_ATTR}', 'model')` : `map()`},
         map(), 'com.anthropic.claude_code.events', NULL, now64(3), now64(3), 30)
    `,
    query_params: {
      pid: `${tag}-${spanId}`,
      tenantId,
      traceId,
      spanId,
      timeMs: String(timeMs),
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
      query: `ALTER TABLE stored_log_records DELETE WHERE startsWith(ProjectionId, {tag:String})`,
      query_params: { tag },
    });
  }
  await stopTestContainers();
});

describe("getMarkedClaudeCodeLogsByTrace partition hint", () => {
  const tenantId = `${tag}-project`;
  const traceId = `${tag}-trace`;

  beforeAll(async () => {
    await insertMarkedLog(tenantId, traceId, `${tag}-a`, TURN_MS - 10_000, true);
    await insertMarkedLog(tenantId, traceId, `${tag}-b`, TURN_MS - 5_000, true);
    // An unmarked log for the same trace must never be returned.
    await insertMarkedLog(tenantId, traceId, `${tag}-c`, TURN_MS - 5_000, false);
  });

  describe("when a TimeUnixMs hint around the turn is supplied", () => {
    it("returns exactly the marked logs, ordered by time", async () => {
      const unbounded = await repo.getMarkedClaudeCodeLogsByTrace(tenantId, traceId);
      // eslint-disable-next-line no-console
      console.error("DBG_UNBOUNDED_TIMES", JSON.stringify(unbounded.map(r => ({s: r.spanId, t: r.timeUnixMs}))));
      const rows = await repo.getMarkedClaudeCodeLogsByTrace(
        tenantId,
        traceId,
        TURN_MS,
      );
      // eslint-disable-next-line no-console
      console.error("DBG_HINTED", JSON.stringify(rows.map(r => r.spanId)), "TURN_MS", TURN_MS);

      expect(rows.map((r) => r.spanId)).toEqual([`${tag}-a`, `${tag}-b`]);
    });
  });

  describe("when no hint is supplied (unbounded fallback)", () => {
    it("returns the same marked logs", async () => {
      const rows = await repo.getMarkedClaudeCodeLogsByTrace(tenantId, traceId);

      expect(rows.map((r) => r.spanId)).toEqual([`${tag}-a`, `${tag}-b`]);
    });
  });
});
