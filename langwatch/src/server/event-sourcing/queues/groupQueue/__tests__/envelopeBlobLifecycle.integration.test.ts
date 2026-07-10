import type { Redis } from "ioredis";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  getTestRedisConnection,
  startTestContainers,
  stopTestContainers,
} from "../../../__tests__/integration/testContainers";
import { EnvelopeBlobLifecycle } from "../envelopeBlobLifecycle";
import { readEnvelopeHold } from "../jobEnvelope";
import { InMemoryObjectStore, incompressible } from "./blobTestDoubles";

const hasTestcontainers = !!(
  process.env.TEST_CLICKHOUSE_URL ||
  process.env.CI_CLICKHOUSE_URL ||
  process.env.REDIS_URL ||
  process.env.CI_REDIS_URL
);

const TENANT_GROUP = "proj1/agg";

// > the 4 KiB inline ceiling, < the 256 KiB s3 threshold → redis tier.
const REDIS_TIER_PAYLOAD = { bulk: "x".repeat(8 * 1024) };

describe.skipIf(!hasTestcontainers)("EnvelopeBlobLifecycle", () => {
  let redis: Redis;
  let objectStore: InMemoryObjectStore;
  let lifecycle: EnvelopeBlobLifecycle;
  let queueName: string;

  beforeAll(async () => {
    await startTestContainers();
    redis = getTestRedisConnection()!;
  });

  beforeEach(() => {
    vi.stubEnv("GROUP_QUEUE_ENVELOPE_WRITES_ENABLED", "true");
    queueName = `{test/lifecycle/${crypto.randomUUID().slice(0, 8)}}`;
    objectStore = new InMemoryObjectStore();
    lifecycle = new EnvelopeBlobLifecycle({
      redis,
      queueName,
      objectStoreFor: () => objectStore,
      resolveStorageDestination: async () => ({
        kind: "s3",
        bucket: "test-bucket",
      }),
      // No reclaim grace by default so out-of-band delete assertions stay
      // prompt; the grace behaviour has its own dedicated suite below.
      s3ReclaimGraceMs: 0,
    });
  });

  afterEach(async () => {
    // Scoped to this suite's hash-tagged namespace, not a global flushall.
    const keys = await redis.keys("{test/lifecycle/*");
    if (keys.length > 0) await redis.del(...keys);
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await stopTestContainers();
  });

  const holderKey = (hash: string) =>
    `${queueName}:gq:blobholders:proj1/${hash}`;
  const blobKey = (hash: string) => `${queueName}:gq:blob:proj1/${hash}`;
  const hashOf = (value: string) => readEnvelopeHold(value)!.ref.hash;

  describe("given an offloaded value whose holder TTL was shortened", () => {
    describe("when it is decoded", () => {
      it("refreshes the holder set on access (so it outlives the blob)", async () => {
        const value = await lifecycle.encode({
          jobData: REDIS_TIER_PAYLOAD,
          groupId: TENANT_GROUP,
        });
        lifecycle.acquire(value);
        const key = holderKey(hashOf(value));
        await vi.waitFor(async () => expect(await redis.scard(key)).toBe(1));
        await redis.expire(key, 100);

        const decoded = await lifecycle.decode({
          value,
          groupId: TENANT_GROUP,
        });

        expect(decoded).toEqual(REDIS_TIER_PAYLOAD);
        await vi.waitFor(async () =>
          expect(await redis.ttl(key)).toBeGreaterThan(100),
        );
      });
    });
  });

  describe("given an offloaded value decoded under a different tenant's group", () => {
    describe("when it is decoded", () => {
      it("refuses the cross-tenant read", async () => {
        const value = await lifecycle.encode({
          jobData: REDIS_TIER_PAYLOAD,
          groupId: TENANT_GROUP,
        });

        await expect(
          lifecycle.decode({ value, groupId: "proj2/agg" }),
        ).rejects.toThrow(/tenant mismatch/i);
      });
    });
  });

  describe("given a held value released under a different tenant's group", () => {
    describe("when released", () => {
      it("leaves the owning tenant's holder set untouched", async () => {
        const value = await lifecycle.encode({
          jobData: REDIS_TIER_PAYLOAD,
          groupId: TENANT_GROUP, // tenant proj1
        });
        lifecycle.acquire(value);
        const key = holderKey(hashOf(value));
        await vi.waitFor(async () => expect(await redis.scard(key)).toBe(1));

        // Release under a foreign group: the proj1 holder must NOT be dropped.
        lifecycle.release({ values: [value], groupId: "proj2/agg" });

        // Wait long enough that an unguarded release would have reclaimed it.
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(await redis.scard(key)).toBe(1);
        expect(await redis.exists(blobKey(hashOf(value)))).toBe(1);
      });
    });
  });

  describe("given a transfer whose new ref belongs to a different tenant", () => {
    describe("when transferred", () => {
      it("never acquires the foreign holder (mirror of the release-side guard)", async () => {
        // Old value is tenant proj1's; new value is tenant proj2's. Under proj1's
        // group, the transfer must NOT acquire proj2's hold.
        const oldValue = await lifecycle.encode({
          jobData: REDIS_TIER_PAYLOAD,
          groupId: TENANT_GROUP, // proj1
        });
        const newValue = await lifecycle.encode({
          jobData: { bulk: "y".repeat(8 * 1024) },
          groupId: "proj2/agg",
        });
        const newHash = hashOf(newValue);
        const newHolderKey = `${queueName}:gq:blobholders:proj2/${newHash}`;
        // Drop the hold proj2's own encode registered: the guard under test is
        // about a foreign value arriving in proj1's group (mis-routed/forged),
        // where no legitimate proj2 staging exists.
        await redis.del(newHolderKey);
        const oldKey = holderKey(hashOf(oldValue));
        expect(await redis.scard(oldKey)).toBe(1); // encode-time hold

        lifecycle.transfer({ newValue, oldValue, groupId: TENANT_GROUP });

        await new Promise((resolve) => setTimeout(resolve, 150));
        // proj2 holder must NOT have been created by the foreign-tenant transfer.
        expect(await redis.exists(newHolderKey)).toBe(0);
        // proj1's hold was released through the guarded path (matches the group's tenant).
        expect(await redis.scard(oldKey)).toBe(0);
      });
    });
  });

  describe("given a same-content retry", () => {
    describe("when the hold is transferred to the re-encoded value", () => {
      it("swaps the slot on one holder set and keeps the blob", async () => {
        const v1 = await lifecycle.encode({
          jobData: REDIS_TIER_PAYLOAD,
          groupId: TENANT_GROUP,
        });
        const v2 = await lifecycle.encode({
          jobData: REDIS_TIER_PAYLOAD,
          groupId: TENANT_GROUP,
        });
        const hash = hashOf(v1);
        expect(hashOf(v2)).toBe(hash); // same content → same blob
        // Each encode registered its own hold up front, so both occupancies
        // are already in the holder set before any transfer runs.
        expect(await redis.scard(holderKey(hash))).toBe(2);

        lifecycle.transfer({
          newValue: v2,
          oldValue: v1,
          groupId: TENANT_GROUP,
        });

        await vi.waitFor(async () => {
          expect(await redis.scard(holderKey(hash))).toBe(1); // old out, new in
          expect(await redis.exists(blobKey(hash))).toBe(1); // blob stays
        });
      });
    });

    describe("when the re-encoded value carries a different __attempt (the queue retry path)", () => {
      it("hashes identically — machinery doesn't perturb the content hash (routing-exclusion)", async () => {
        // This is the queue-level retry-cheapness guarantee: the retry re-encode
        // produces the SAME blob hash, so the atomic transfer is a same-set
        // SADD+SREM (one Lua eval, blob untouched) rather than a cross-set
        // reclaim. Without routing-exclusion, __attempt would perturb the body
        // bytes and each retry would churn through a fresh blob.
        const v1 = await lifecycle.encode({
          jobData: { ...REDIS_TIER_PAYLOAD, __attempt: 1 },
          groupId: TENANT_GROUP,
        });
        const v2 = await lifecycle.encode({
          jobData: { ...REDIS_TIER_PAYLOAD, __attempt: 2 },
          groupId: TENANT_GROUP,
        });

        expect(hashOf(v2)).toBe(hashOf(v1));
        const key = holderKey(hashOf(v1));
        // Both encode-time holds are registered before anything is staged.
        expect(await redis.scard(key)).toBe(2);

        lifecycle.transfer({
          newValue: v2,
          oldValue: v1,
          groupId: TENANT_GROUP,
        });

        await vi.waitFor(async () => {
          expect(await redis.scard(key)).toBe(1);
          expect(await redis.exists(blobKey(hashOf(v1)))).toBe(1);
        });
      });
    });
  });

  describe("given a dedup squash to different content", () => {
    describe("when the hold is transferred across blobs", () => {
      it("reclaims the displaced redis blob and holds the new one", async () => {
        const vOld = await lifecycle.encode({
          jobData: { bulk: "a".repeat(8 * 1024) },
          groupId: TENANT_GROUP,
        });
        const vNew = await lifecycle.encode({
          jobData: { bulk: "b".repeat(8 * 1024) },
          groupId: TENANT_GROUP,
        });
        const oldHash = hashOf(vOld);
        const newHash = hashOf(vNew);
        expect(newHash).not.toBe(oldHash);
        lifecycle.acquire(vOld);
        await vi.waitFor(async () =>
          expect(await redis.scard(holderKey(oldHash))).toBe(1),
        );

        lifecycle.transfer({
          newValue: vNew,
          oldValue: vOld,
          groupId: TENANT_GROUP,
        });

        await vi.waitFor(async () => {
          expect(await redis.exists(blobKey(oldHash))).toBe(0); // displaced blob reclaimed
          expect(await redis.scard(holderKey(newHash))).toBe(1); // new blob held
        });
      });
    });
  });

  describe("given an s3-tier blob held by one slot", () => {
    describe("when the last holder releases", () => {
      it("deletes the s3 object out-of-band", async () => {
        const value = await lifecycle.encode({
          jobData: { bulk: incompressible(768 * 1024) }, // > 256 KiB gzipped → s3
          groupId: TENANT_GROUP,
        });
        expect(readEnvelopeHold(value)!.ref.tier).toBe("s3");
        expect(objectStore.store.size).toBe(1);
        lifecycle.acquire(value);

        lifecycle.release({ values: [value], groupId: TENANT_GROUP });

        await vi.waitFor(() => {
          expect(objectStore.deleted).toHaveLength(1);
          expect(objectStore.store.size).toBe(0);
        });
      });
    });
  });

  describe("given a transfer where one side is not a GQ2 hold", () => {
    describe("when a GQ2 value replaces an inline value", () => {
      it("falls back to ordered acquire+release without throwing", async () => {
        const inlineValue = await lifecycle.encode({
          jobData: { small: 1 }, // under the inline ceiling → no hold
          groupId: TENANT_GROUP,
        });
        const gq2Value = await lifecycle.encode({
          jobData: REDIS_TIER_PAYLOAD,
          groupId: TENANT_GROUP,
        });
        expect(readEnvelopeHold(inlineValue)).toBeNull();
        expect(readEnvelopeHold(gq2Value)).not.toBeNull();

        lifecycle.transfer({
          newValue: gq2Value,
          oldValue: inlineValue,
          groupId: TENANT_GROUP,
        });

        await vi.waitFor(async () =>
          expect(await redis.scard(holderKey(hashOf(gq2Value)))).toBe(1),
        );
      });
    });
  });

  describe("given stagings sharing one content-addressed blob", () => {
    describe("when a value is encoded", () => {
      it("registers the occupancy's hold before encode returns", async () => {
        const value = await lifecycle.encode({
          jobData: REDIS_TIER_PAYLOAD,
          groupId: TENANT_GROUP,
        });

        // No acquire() call: by the time the value exists (and could be
        // staged), the hold must already be in the holder set — a hold that
        // only lands after staging leaves a window where a sibling's release
        // reclaims the shared blob.
        const hold = readEnvelopeHold(value)!;
        expect(await redis.smembers(holderKey(hold.ref.hash))).toContain(
          hold.token,
        );
      });
    });

    describe("when one staging retires before a concurrent one dispatches", () => {
      it("keeps the shared s3 blob alive for the remaining staging", async () => {
        const shared = { bulk: incompressible(768 * 1024) }; // > 256 KiB gzipped → s3
        const first = await lifecycle.encode({
          jobData: shared,
          groupId: TENANT_GROUP,
        });
        const second = await lifecycle.encode({
          jobData: shared,
          groupId: TENANT_GROUP,
        });
        expect(readEnvelopeHold(second)!.ref.tier).toBe("s3");
        // Ensure the FIRST staging's hold has landed (post-stage refresh), so
        // its release below actually removes a member — the interleave where a
        // hold-after-staging design empties the set and reclaims the blob out
        // from under the second staging.
        lifecycle.acquire(first);
        await vi.waitFor(async () =>
          expect(await redis.scard(holderKey(hashOf(first)))).toBeGreaterThan(
            0,
          ),
        );

        // The first staging completes and releases its hold while the second
        // is still awaiting dispatch.
        lifecycle.release({ values: [first], groupId: TENANT_GROUP });
        // Wait past the point an unguarded release would have deleted it.
        await new Promise((resolve) => setTimeout(resolve, 150));

        expect(objectStore.deleted).toHaveLength(0);
        expect(
          await lifecycle.decode({ value: second, groupId: TENANT_GROUP }),
        ).toEqual(shared);
      });

      it("keeps the shared redis blob alive for the remaining staging", async () => {
        const first = await lifecycle.encode({
          jobData: REDIS_TIER_PAYLOAD,
          groupId: TENANT_GROUP,
        });
        const second = await lifecycle.encode({
          jobData: REDIS_TIER_PAYLOAD,
          groupId: TENANT_GROUP,
        });
        lifecycle.acquire(first);
        await vi.waitFor(async () =>
          expect(await redis.scard(holderKey(hashOf(first)))).toBeGreaterThan(
            0,
          ),
        );

        lifecycle.release({ values: [first], groupId: TENANT_GROUP });
        await new Promise((resolve) => setTimeout(resolve, 150));

        expect(await redis.exists(blobKey(hashOf(second)))).toBe(1);
        expect(
          await lifecycle.decode({ value: second, groupId: TENANT_GROUP }),
        ).toEqual(REDIS_TIER_PAYLOAD);
      });
    });
  });

  describe("given an s3 reclaim decision with a grace window", () => {
    const gracedLifecycle = (graceMs: number) =>
      new EnvelopeBlobLifecycle({
        redis,
        queueName,
        objectStoreFor: () => objectStore,
        resolveStorageDestination: async () => ({
          kind: "s3",
          bucket: "test-bucket",
        }),
        s3ReclaimGraceMs: graceMs,
      });

    describe("when the same content is re-held before the delete executes", () => {
      it("skips the delete so the new occupancy never references a deleted object", async () => {
        const graced = gracedLifecycle(200);
        const shared = { bulk: incompressible(768 * 1024) };
        const first = await graced.encode({
          jobData: shared,
          groupId: TENANT_GROUP,
        });

        // Sole holder retires → reclaim decided; a new staging re-holds the
        // same content inside the grace window.
        graced.release({ values: [first], groupId: TENANT_GROUP });
        const second = await graced.encode({
          jobData: shared,
          groupId: TENANT_GROUP,
        });

        await new Promise((resolve) => setTimeout(resolve, 400));
        expect(objectStore.deleted).toHaveLength(0);
        expect(
          await graced.decode({ value: second, groupId: TENANT_GROUP }),
        ).toEqual(shared);
      });
    });

    describe("when nothing re-holds the content within the grace", () => {
      it("deletes the object once the grace elapses", async () => {
        const graced = gracedLifecycle(100);
        const value = await graced.encode({
          jobData: { bulk: incompressible(768 * 1024) },
          groupId: TENANT_GROUP,
        });

        graced.release({ values: [value], groupId: TENANT_GROUP });

        await vi.waitFor(() => expect(objectStore.deleted).toHaveLength(1), {
          timeout: 2000,
          interval: 25,
        });
      });
    });
  });
});
