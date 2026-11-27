/** The queue lists each tenant's claimed groups; specs/tenant-claims-index.feature, ADR-092. */

import IORedis, { type Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { GROUP_KEY_TTL_MS, GroupStagingScripts } from "../scripts.ts";
import { backfillTenantClaims, readTenantClaimedGroups } from "../tenantClaims.ts";

const SUITE = "{test/gqclaims/";

let redis: Redis;

beforeAll(() => {
  redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: 0,
  });
});

afterEach(async () => {
  // Scoped to this suite's own namespace, never flushdb().
  const keys = await redis.keys(`${SUITE}*`);
  if (keys.length > 0) await redis.del(...keys);
});

afterAll(async () => {
  await redis.quit();
});

const GROUP = "tenant-a/state/conversationState/conversation-1";
const PREFIX = "tenant-a/state/conversationState/";

function freshQueue() {
  const name = `${SUITE}${crypto.randomUUID().slice(0, 8)}}`;
  const keyPrefix = `${name}:gq:`;
  const scripts = new GroupStagingScripts(redis, name);
  return {
    name,
    keyPrefix,
    scripts,
    indexKey: (tenantId: string) => `${keyPrefix}tenant-claims:${tenantId}`,
    claimed: () =>
      readTenantClaimedGroups({
        redis,
        queueName: name,
        tenantId: "tenant-a",
        groupIdPrefix: PREFIX,
      }),
    async claim({ groupId = GROUP, stagedJobId = "j1" } = {}) {
      await scripts.stage({
        stagedJobId,
        groupId,
        dispatchAfterMs: 100,
        dedupId: "",
        dedupTtlMs: 0,
        jobDataJson: JSON.stringify({ stagedJobId }),
      });
      const claim = await scripts.dispatch({ nowMs: 1_000, activeTtlSec: 60 });
      expect(claim?.groupId).toBe(groupId);
      return claim!;
    },
  };
}

describe("tenant claims index", () => {
  describe("given a claimed group of a tenant", () => {
    /** @scenario "A claimed group is listed under its tenant until it completes" */
    it("lists the group while it runs and drops it when it completes", async () => {
      const q = freshQueue();
      const claim = await q.claim();

      expect(await q.claimed()).toEqual([GROUP]);

      await q.scripts.complete({
        groupId: GROUP,
        stagedJobId: claim.stagedJobId,
        claimToken: claim.claimToken,
      });
      expect(await q.claimed()).toEqual([]);
      expect(await redis.exists(q.indexKey("tenant-a"))).toBe(0);
    });

    /** @scenario "A group waiting out a retry backoff is still listed" */
    it("keeps the group listed through a retry backoff", async () => {
      const q = freshQueue();
      const claim = await q.claim();

      await q.scripts.retryRestage({
        groupId: GROUP,
        stagedJobId: claim.stagedJobId,
        newStagedJobId: claim.stagedJobId,
        dispatchAfterMs: 5_000,
        jobDataJson: JSON.stringify({ stagedJobId: claim.stagedJobId }),
        backoffMs: 5_000,
        claimToken: claim.claimToken,
        attempt: 1,
        attemptTtlSec: 60,
      });

      expect(await redis.exists(`${q.keyPrefix}group:${GROUP}:claimed`)).toBe(0);
      expect(await q.claimed()).toEqual([GROUP]);
    });

    /** @scenario "Only the asked projection's groups are returned" */
    it("returns only groups under the asked prefix", async () => {
      const q = freshQueue();
      await q.claim();
      await q.claim({ groupId: "tenant-a/map/spanAnalytics/span-1", stagedJobId: "j2" });

      expect(await q.claimed()).toEqual([GROUP]);
    });

    /** @scenario "A group whose keys are gone leaves the index on the next read" */
    it("drops a member whose active key and claimed record are both gone", async () => {
      const q = freshQueue();
      await q.claim();
      await redis.del(
        `${q.keyPrefix}group:${GROUP}:active`,
        `${q.keyPrefix}group:${GROUP}:claimed`,
      );

      expect(await q.claimed()).toEqual([]);
      expect(await redis.smembers(q.indexKey("tenant-a"))).toEqual([]);
    });
  });

  describe("given a claimed group whose worker keeps heartbeating", () => {
    /** @scenario "A heartbeat keeps the tenant's claim list alive" */
    it("pushes the claim list's expiry back to the key lifetime", async () => {
      const q = freshQueue();
      const claim = await q.claim();
      await redis.pexpire(q.indexKey("tenant-a"), 1_000);

      const refreshed = await q.scripts.refreshActiveKey({
        groupId: GROUP,
        stagedJobId: claim.stagedJobId,
        claimToken: claim.claimToken,
        activeTtlSec: 60,
      });

      expect(refreshed).toBe(true);
      expect(await redis.pttl(q.indexKey("tenant-a"))).toBeGreaterThan(GROUP_KEY_TTL_MS - 60_000);
    });
  });

  describe("given a claimed group whose worker died", () => {
    /** @scenario "A dead worker's surviving claim stays listed" */
    it("keeps the group listed while its claimed record remains", async () => {
      const q = freshQueue();
      await q.claim();
      await redis.del(`${q.keyPrefix}group:${GROUP}:active`);

      expect(await redis.exists(`${q.keyPrefix}group:${GROUP}:claimed`)).toBe(1);
      expect(await q.claimed()).toEqual([GROUP]);
    });
  });

  describe("given a group with no tenant prefix", () => {
    it("indexes nothing", async () => {
      const q = freshQueue();
      await q.claim({ groupId: "plain-group" });

      expect(await redis.keys(`${q.keyPrefix}tenant-claims:*`)).toEqual([]);
    });
  });

  describe("given claims made before the index existed", () => {
    /** @scenario "The backfill lists claims an older worker made" */
    it("lists them after the backfill walks the keyspace", async () => {
      const q = freshQueue();
      await q.claim();
      await redis.del(q.indexKey("tenant-a"));
      expect(await q.claimed()).toEqual([]);

      let cursor = "0";
      do {
        ({ cursor } = await backfillTenantClaims({
          redis,
          queueName: q.name,
          cursor,
          maxScanCalls: 1,
        }));
      } while (cursor !== "0");

      expect(await q.claimed()).toEqual([GROUP]);
    });
  });
});
