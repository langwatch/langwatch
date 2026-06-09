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
import {
  startTestContainers,
  stopTestContainers,
} from "../../../../event-sourcing/__tests__/integration/testContainers";
import { CLAUDE_CODE_KIND_ATTR } from "../../claude-code-log-to-span";
import { LogRecordStorageClickHouseRepository } from "../log-record-storage.clickhouse.repository";

let ch: ClickHouseClient;
let repo: LogRecordStorageClickHouseRepository;
const tag = nanoid();

// Insert at server `now64(3)` minus a few seconds so the rows stay inside the
// short retention floor (a fixed past date would be GC'd by the _retention_days
// TTL). The +/-2-day hint window dwarfs any host-vs-container clock skew, so the
// host-side Date.now() hint reliably covers the container-side insert time.
async function insertMarkedLog(
  tenantId: string,
  traceId: string,
  spanId: string,
  agoSec: number,
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
         now64(3) - {agoSec:UInt32}, 9, 'INFO', '{}',
         ${marked ? `map('${CLAUDE_CODE_KIND_ATTR}', 'model')` : `map()`},
         map(), 'com.anthropic.claude_code.events', NULL, now64(3), now64(3), 30)
    `,
    query_params: {
      pid: `${tag}-${spanId}`,
      tenantId,
      traceId,
      spanId,
      agoSec,
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

describe("getMarkedClaudeCodeLogsByTrace partition hint", () => {
  const tenantId = `${tag}-project`;
  const traceId = `${tag}-trace`;

  beforeAll(async () => {
    await insertMarkedLog(tenantId, traceId, `${tag}-a`, 10, true);
    await insertMarkedLog(tenantId, traceId, `${tag}-b`, 5, true);
    // An unmarked log for the same trace must never be returned.
    await insertMarkedLog(tenantId, traceId, `${tag}-c`, 5, false);
  });

  describe("when a TimeUnixMs hint around the turn is supplied", () => {
    it("returns exactly the marked logs, ordered by time", async () => {
      const rows = await repo.getMarkedClaudeCodeLogsByTrace(
        tenantId,
        traceId,
        Date.now(),
      );

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
