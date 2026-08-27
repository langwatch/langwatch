/**
 * @vitest-environment node
 * @integration
 *
 * The daily ceiling against REAL Redis.
 *
 * The unit suite next door mocks `connection` away and so only ever exercises
 * the in-memory fallback. That leaves the path production actually runs — the
 * claim-and-count Lua script — unpinned, and the properties that matter there
 * are properties of Redis: that the claim and the INCR land together, that the
 * TTL does not slide, and that a retry re-reads rather than re-counts.
 */

import { type RedisConnection, RedisConnectionService } from "@langwatch/redis-client";
import { nanoid } from "nanoid";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AutomationPersistCapService } from "@langwatch/automation-server/testing";

/** Injected into every call, so this suite needs no App (ADR-093). */
let connection: RedisConnection | null = null;

const PROJECT_ID = `proj-${nanoid(8)}`;
const NOW = new Date("2026-08-09T12:00:00.000Z");

const writtenKeys: string[] = [];

function triggerId(): string {
  return `trig-${nanoid(8)}`;
}

function consume({
  trigger,
  traceId,
  cap = 2,
}: {
  trigger: string;
  traceId: string;
  cap?: number;
}) {
  const dedupKey = `${PROJECT_ID}/${trigger}:persist:${traceId}`;
  writtenKeys.push(
    AutomationPersistCapService.persistCapKey({
      projectId: PROJECT_ID,
      triggerId: trigger,
      now: NOW,
    }),
    AutomationPersistCapService.persistCapClaimKey({
      projectId: PROJECT_ID,
      triggerId: trigger,
      dedupKey,
    }),
  );
  return AutomationPersistCapService.consumePersistCapSlot({
    projectId: PROJECT_ID,
    triggerId: trigger,
    now: NOW,
    cap,
    dedupKey,
    redis: connection,
  });
}

beforeAll(() => {
  connection = new RedisConnectionService().connect({
    url: process.env.REDIS_URL,
    clusterEndpoints: process.env.REDIS_CLUSTER_ENDPOINTS,
    dbIndex: process.env.REDIS_DB_INDEX,
  });
  if (!connection) {
    throw new Error("This suite needs Redis. Set LANGWATCH_TEST_REDIS_URL in .env.");
  }
});

afterAll(() => {
  connection?.disconnect();
});

afterEach(async () => {
  // One key per DEL: keys for different triggers carry different hash tags, so
  // a multi-key DEL would fail with CROSSSLOT on a Redis Cluster connection
  // and a failed teardown would strand keys with a 25h TTL.
  for (const key of writtenKeys) {
    await connection?.del(key);
  }
  writtenKeys.length = 0;
});

describe("Feature: the automation daily ceiling on Redis", () => {
  describe("given a trigger that has not dispatched today", () => {
    describe("when confirmed dispatches consume slots", () => {
      it("counts each distinct dispatch once", async () => {
        const trigger = triggerId();

        expect(await consume({ trigger, traceId: "t1" })).toMatchObject({
          allowed: true,
          count: 1,
        });
        expect(await consume({ trigger, traceId: "t2" })).toMatchObject({
          allowed: true,
          count: 2,
        });
        expect(await consume({ trigger, traceId: "t3" })).toMatchObject({
          allowed: false,
          count: 3,
          skipped: 1,
        });
      });

      it("gives the day counter a TTL so it cannot outlive its day", async () => {
        const trigger = triggerId();
        await consume({ trigger, traceId: "t1" });

        const ttl = await connection!.ttl(
          AutomationPersistCapService.persistCapKey({
            projectId: PROJECT_ID,
            triggerId: trigger,
            now: NOW,
          }),
        );

        // 25h of headroom, one hour past the window it covers.
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(90_000);
      });
    });
  });

  describe("given a dispatch that already consumed a slot", () => {
    describe("when the outbox retries it", () => {
      /** @scenario "An outbox retry of the same dispatch does not consume a second slot" */
      it("re-reads the running count instead of burning another slot", async () => {
        const trigger = triggerId();
        await consume({ trigger, traceId: "t1" });

        const retry = await consume({ trigger, traceId: "t1" });

        expect(retry).toMatchObject({ allowed: true, count: 1 });
      });

      it("does not slide the day counter's TTL", async () => {
        // An EXPIRE without NX on every retry would push the counter's
        // expiry forward indefinitely under a retry storm, and a counter that
        // never expires is a ceiling that never resets.
        const trigger = triggerId();
        const key = AutomationPersistCapService.persistCapKey({
          projectId: PROJECT_ID,
          triggerId: trigger,
          now: NOW,
        });
        await consume({ trigger, traceId: "t1" });
        await connection!.expire(key, 60);

        // A DISTINCT dispatch: it wins its own claim and reaches the INCR and
        // the TTL guard. A retry of t1 would lose the claim and return at the
        // GET, never touching EXPIRE, and would pass even with the guard gone.
        await consume({ trigger, traceId: "t2" });

        expect(await connection!.ttl(key)).toBeLessThanOrEqual(60);
      });
    });
  });

  describe("given many workers racing the same ceiling", () => {
    describe("when they consume slots concurrently", () => {
      it("counts every distinct dispatch exactly once", async () => {
        // The claim and the INCR are one script precisely so this cannot lose
        // or double-count under concurrency. Issued as separate commands, an
        // interleaving that claims before another worker's INCR returns can
        // leave a dispatch claimed but uncounted.
        const trigger = triggerId();
        const traceIds = Array.from({ length: 25 }, (_, index) => `t${index}`);

        await Promise.all(traceIds.map((traceId) => consume({ trigger, traceId, cap: 1_000 })));

        const raw = await connection!.get(
          AutomationPersistCapService.persistCapKey({
            projectId: PROJECT_ID,
            triggerId: trigger,
            now: NOW,
          }),
        );
        expect(Number(raw)).toBe(traceIds.length);
      });

      it("counts a repeated dispatch once however many workers present it", async () => {
        const trigger = triggerId();

        const results = await Promise.all(
          Array.from({ length: 10 }, () => consume({ trigger, traceId: "same-trace", cap: 1_000 })),
        );

        expect(results.every((result) => result.count === 1)).toBe(true);
      });
    });
  });
});
