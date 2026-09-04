import IORedis, { type Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GroupStagingScripts } from "../scripts";

/**
 * The `recordSpan` command's GroupQueue staging dedup identity: at most one
 * staged `:data` entry per `(tenant, trace, span)` within the dedup window,
 * so worker-side redelivery (past the ingestion-layer `SpanDedupService`
 * gate) cannot grow a group's staging hash unboundedly.
 *
 * The identity function mirrors `RECORD_SPAN_DEDUPLICATION.makeId` in
 * `packages/features/trace/server/src/adapters/eventing.record-span.adapter.ts`
 * (`${tenantId}:${traceId}:${spanId}`); this suite exercises the underlying
 * `GroupStagingScripts.stage` dedup mechanism directly rather than importing
 * trace-domain code into this package.
 *
 * Spec: specs/traces/record-span-gq-dedup.feature
 */

let redis: Redis;
let scripts: GroupStagingScripts;
const QUEUE_NAME = "{test/record-span-dedup}";

function keyPrefix() {
  return `${QUEUE_NAME}:gq:`;
}

function dataKey(groupId: string) {
  return `${keyPrefix()}group:${groupId}:data`;
}

/** The same shape RECORD_SPAN_DEDUPLICATION.makeId builds. */
function spanDedupId(tenantId: string, traceId: string, spanId: string): string {
  return `${tenantId}:${traceId}:${spanId}`;
}

function stageSpan({
  tenantId,
  traceId,
  spanId,
  payload,
}: {
  tenantId: string;
  traceId: string;
  spanId: string;
  payload: string;
}) {
  const groupId = `${tenantId}/${traceId}`;
  return scripts.stage({
    stagedJobId: `job-${crypto.randomUUID().slice(0, 8)}`,
    groupId,
    dispatchAfterMs: 1000,
    dedupId: spanDedupId(tenantId, traceId, spanId),
    // RECORD_SPAN_DEDUPLICATION.ttlMs.
    dedupTtlMs: 30_000,
    jobDataJson: JSON.stringify({ payload }),
    shouldExtend: true,
    shouldReplace: true,
  });
}

async function deleteSuiteKeys(): Promise<void> {
  const keys = await redis.keys(`${QUEUE_NAME}*`);
  if (keys.length > 0) await redis.del(...keys);
}

beforeAll(() => {
  redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: 0,
  });
});

beforeEach(async () => {
  await deleteSuiteKeys();
  scripts = new GroupStagingScripts(redis, QUEUE_NAME);
});

afterAll(async () => {
  await deleteSuiteKeys();
  await redis.quit();
});

describe("recordSpan GroupQueue staging dedup identity", () => {
  describe("given a tenant, trace, and span identity", () => {
    /** @scenario Repeated dispatches of the same span identity collapse to one staged entry */
    it("holds exactly one :data entry for that identity, latest payload winning", async () => {
      const tenantId = "proj_acme";
      const traceId = "trace-1";
      const spanId = "span-1";
      const groupId = `${tenantId}/${traceId}`;

      for (let i = 0; i < 5; i++) {
        await stageSpan({ tenantId, traceId, spanId, payload: `attempt-${i}` });
      }

      expect(await redis.hlen(dataKey(groupId))).toBe(1);
      const [field] = await redis.hkeys(dataKey(groupId));
      const stored = await redis.hget(dataKey(groupId), field!);
      expect(JSON.parse(stored!)).toEqual({ payload: "attempt-4" });
    });
  });

  describe("given a tenant and trace with multiple distinct span identities", () => {
    /** @scenario Distinct span identities on the same trace each get their own staged entry */
    it("holds one :data entry per distinct identity", async () => {
      const tenantId = "proj_acme";
      const traceId = "trace-2";
      const groupId = `${tenantId}/${traceId}`;

      await stageSpan({ tenantId, traceId, spanId: "span-a", payload: "a" });
      await stageSpan({ tenantId, traceId, spanId: "span-b", payload: "b" });
      await stageSpan({ tenantId, traceId, spanId: "span-c", payload: "c" });

      expect(await redis.hlen(dataKey(groupId))).toBe(3);
    });
  });
});
