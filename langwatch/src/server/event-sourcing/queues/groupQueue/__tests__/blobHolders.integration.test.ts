import IORedis, { type Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import { BLOB_HOLDER_TTL_SECONDS } from "../blobConstants";
import { BlobHolders } from "../blobHolders";

// Self-contained: connects to the dev/CI Redis directly (the holder set + the
// release script are pure Redis), scoped to a dedicated hash-tagged prefix.
const QUEUE_NAME = "{test/holders}";
const PREFIX = `${QUEUE_NAME}:gq:`;
const PROJECT = createTenantId("proj-1");
const HASH = "abc123hash";

const blobKey = `${PREFIX}blob:${PROJECT}/${HASH}`;
const holderKey = `${PREFIX}blobholders:${PROJECT}/${HASH}`;

let redis: Redis;
let holders: BlobHolders;

async function clearSuiteKeys() {
  const keys = await redis.keys(`${PREFIX}*`);
  if (keys.length > 0) await redis.del(...keys);
}

beforeAll(() => {
  redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: 0,
  });
});

beforeEach(async () => {
  await clearSuiteKeys();
  holders = new BlobHolders({ redis, queueName: QUEUE_NAME });
});

afterAll(async () => {
  await clearSuiteKeys();
  await redis.quit();
});

function release(slotId: string, tier: "redis" | "s3" = "redis") {
  return holders.release({ projectId: PROJECT, hash: HASH, tier, slotId });
}

describe("BlobHolders", () => {
  describe("given a redis-tier blob held by three slots", () => {
    beforeEach(async () => {
      await redis.set(blobKey, Buffer.from("body"));
      for (const slot of ["s1", "s2", "s3"]) {
        await holders.acquire({ projectId: PROJECT, hash: HASH, slotId: slot });
      }
    });

    describe("when two of the three slots release", () => {
      it("keeps the blob while a slot still holds it", async () => {
        expect(await release("s1")).toBe("still-held");
        expect(await release("s2")).toBe("still-held");
        expect(await redis.exists(blobKey)).toBe(1);
      });
    });

    describe("when the last slot releases", () => {
      it("reclaims the blob and drops the holder set", async () => {
        await release("s1");
        await release("s2");
        expect(await release("s3")).toBe("reclaimed-redis");
        expect(await redis.exists(blobKey)).toBe(0);
        expect(await redis.exists(holderKey)).toBe(0);
      });
    });
  });

  describe("given a blob held by two slots", () => {
    beforeEach(async () => {
      await redis.set(blobKey, Buffer.from("body"));
      await holders.acquire({ projectId: PROJECT, hash: HASH, slotId: "s1" });
      await holders.acquire({ projectId: PROJECT, hash: HASH, slotId: "s2" });
    });

    describe("when one slot releases twice", () => {
      it("is idempotent and never reclaims while the other slot holds", async () => {
        expect(await release("s1")).toBe("still-held");
        expect(await release("s1")).toBe("still-held");
        expect(await redis.exists(blobKey)).toBe(1);
      });
    });
  });

  describe("given an s3-tier blob whose last holder releases", () => {
    describe("when released", () => {
      it("signals the caller to reclaim the object and drops the holder set", async () => {
        await holders.acquire({ projectId: PROJECT, hash: HASH, slotId: "s1" });
        expect(await release("s1", "s3")).toBe("reclaim-s3");
        expect(await redis.exists(holderKey)).toBe(0);
      });
    });
  });

  describe("given a freshly acquired holder set", () => {
    describe("when its TTL is read", () => {
      it("carries the refreshed backstop window", async () => {
        await holders.acquire({ projectId: PROJECT, hash: HASH, slotId: "s1" });
        const ttl = await redis.ttl(holderKey);
        expect(ttl).toBeGreaterThan(BLOB_HOLDER_TTL_SECONDS - 60);
        expect(ttl).toBeLessThanOrEqual(BLOB_HOLDER_TTL_SECONDS);
      });
    });
  });

  describe("given a holder set whose TTL was shortened", () => {
    describe("when touched", () => {
      it("refreshes it back toward the holder window", async () => {
        await holders.acquire({ projectId: PROJECT, hash: HASH, slotId: "s1" });
        await redis.expire(holderKey, 100);

        await holders.touch({ projectId: PROJECT, hash: HASH });

        const ttl = await redis.ttl(holderKey);
        expect(ttl).toBeGreaterThan(100);
        expect(ttl).toBeLessThanOrEqual(BLOB_HOLDER_TTL_SECONDS);
      });
    });
  });

  describe("given a same-content retry (transfer within one holder set)", () => {
    describe("when the hold is transferred to the new slot", () => {
      it("swaps old for new and keeps the blob held", async () => {
        await redis.set(blobKey, Buffer.from("body"));
        await holders.acquire({
          projectId: PROJECT,
          hash: HASH,
          slotId: "old",
        });

        const outcome = await holders.transfer({
          newProjectId: PROJECT,
          newHash: HASH,
          newSlotId: "new",
          oldProjectId: PROJECT,
          oldHash: HASH,
          oldTier: "redis",
          oldSlotId: "old",
        });

        expect(outcome).toBe("still-held");
        expect(await redis.smembers(holderKey)).toEqual(["new"]);
        expect(await redis.exists(blobKey)).toBe(1);
      });
    });
  });

  describe("given a dedup squash to different content (cross-set transfer)", () => {
    describe("when the hold is transferred to a different blob", () => {
      it("reclaims the displaced blob and holds the new one", async () => {
        const newHash = "newhash999";
        const newBlobKey = `${PREFIX}blob:${PROJECT}/${newHash}`;
        const newHolderKey = `${PREFIX}blobholders:${PROJECT}/${newHash}`;
        await redis.set(blobKey, Buffer.from("old body"));
        await redis.set(newBlobKey, Buffer.from("new body"));
        await holders.acquire({
          projectId: PROJECT,
          hash: HASH,
          slotId: "old",
        });

        const outcome = await holders.transfer({
          newProjectId: PROJECT,
          newHash,
          newSlotId: "new",
          oldProjectId: PROJECT,
          oldHash: HASH,
          oldTier: "redis",
          oldSlotId: "old",
        });

        expect(outcome).toBe("reclaimed-redis");
        expect(await redis.exists(blobKey)).toBe(0); // displaced blob reclaimed
        expect(await redis.exists(newBlobKey)).toBe(1); // new blob untouched
        expect(await redis.smembers(newHolderKey)).toEqual(["new"]);
      });
    });
  });

  describe("given a dedup squash displacing an s3-tier blob", () => {
    describe("when the hold is transferred across blobs", () => {
      it("signals reclaim-s3 and drops the old holder set", async () => {
        const newHash = "newhashs3";
        const newHolderKey = `${PREFIX}blobholders:${PROJECT}/${newHash}`;
        await holders.acquire({
          projectId: PROJECT,
          hash: HASH,
          slotId: "old",
        });

        const outcome = await holders.transfer({
          newProjectId: PROJECT,
          newHash,
          newSlotId: "new",
          oldProjectId: PROJECT,
          oldHash: HASH,
          oldTier: "s3",
          oldSlotId: "old",
        });

        expect(outcome).toBe("reclaim-s3");
        expect(await redis.exists(holderKey)).toBe(0); // old holder dropped
        expect(await redis.smembers(newHolderKey)).toEqual(["new"]);
      });
    });
  });

  describe("given a release for a slot that was never acquired", () => {
    describe("when released", () => {
      it("is a no-op (still-held), never a spurious reclaim", async () => {
        await redis.set(blobKey, Buffer.from("body"));
        await holders.acquire({
          projectId: PROJECT,
          hash: HASH,
          slotId: "real",
        });

        const outcome = await holders.release({
          projectId: PROJECT,
          hash: HASH,
          tier: "redis",
          slotId: "never-acquired",
        });

        expect(outcome).toBe("still-held");
        expect(await redis.exists(blobKey)).toBe(1);
        expect(await redis.smembers(holderKey)).toEqual(["real"]);
      });
    });
  });

  describe("given a self-transfer (same holder set and slot)", () => {
    describe("when transferred", () => {
      it("refreshes the hold and keeps the blob", async () => {
        await redis.set(blobKey, Buffer.from("body"));
        await holders.acquire({ projectId: PROJECT, hash: HASH, slotId: "s1" });

        const outcome = await holders.transfer({
          newProjectId: PROJECT,
          newHash: HASH,
          newSlotId: "s1",
          oldProjectId: PROJECT,
          oldHash: HASH,
          oldTier: "redis",
          oldSlotId: "s1",
        });

        expect(outcome).toBe("still-held");
        expect(await redis.exists(blobKey)).toBe(1);
        expect(await redis.smembers(holderKey)).toEqual(["s1"]);
      });
    });
  });
});
