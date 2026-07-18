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
import { BlobLeases } from "../blobLeases";
import { EnvelopeBlobLifecycle } from "../envelopeBlobLifecycle";
import { readEnvelopeLease } from "../jobEnvelope";
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
  let leases: BlobLeases;
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
    });
    leases = new BlobLeases({ redis, queueName });
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

  const leaseKey = (hash: string) => `${queueName}:gq:blobleases:proj1/${hash}`;
  const blobKey = (hash: string) => `${queueName}:gq:blob:proj1/${hash}`;
  const hashOf = (value: string) => readEnvelopeLease(value)!.ref.hash;
  const seedLease = async (value: string) => {
    const lease = readEnvelopeLease(value)!;
    await leases.take({
      projectId: lease.ref.projectId,
      hash: lease.ref.hash,
      holderId: lease.holderId,
    });
  };
  const redisNowMs = async () => {
    const [seconds, microseconds] = await redis.time();
    return Number(seconds) * 1000 + Math.floor(Number(microseconds) / 1000);
  };

  describe("given an offloaded value whose lease deadline was shortened", () => {
    describe("when it is decoded", () => {
      it("renews the holder lease on access", async () => {
        const value = await lifecycle.encode({
          jobData: REDIS_TIER_PAYLOAD,
          groupId: TENANT_GROUP,
        });
        await seedLease(value);
        const lease = readEnvelopeLease(value)!;
        const key = leaseKey(hashOf(value));
        await redis.zadd(key, (await redisNowMs()) + 100, lease.holderId);

        const decoded = await lifecycle.decode({
          value,
          groupId: TENANT_GROUP,
        });

        expect(decoded).toEqual(REDIS_TIER_PAYLOAD);
        await vi.waitFor(async () => {
          const deadline = Number(await redis.zscore(key, lease.holderId));
          expect(deadline).toBeGreaterThan((await redisNowMs()) + 100);
        });
      });
    });
  });

  describe("given an in-flight value whose lease deadline was shortened", () => {
    describe("when its active-job heartbeat renews the lease", () => {
      it("moves that holder's deadline forward", async () => {
        const value = await lifecycle.encode({
          jobData: REDIS_TIER_PAYLOAD,
          groupId: TENANT_GROUP,
        });
        await seedLease(value);
        const lease = readEnvelopeLease(value)!;
        const key = leaseKey(lease.ref.hash);
        await redis.zadd(key, (await redisNowMs()) + 100, lease.holderId);
        await redis.expire(blobKey(lease.ref.hash), 1);

        await lifecycle.renewLease(value);

        const deadline = Number(await redis.zscore(key, lease.holderId));
        expect(deadline).toBeGreaterThan((await redisNowMs()) + 100);
        expect(await redis.ttl(blobKey(lease.ref.hash))).toBeGreaterThan(1);
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

  describe("given a leased value released under a different tenant's group", () => {
    describe("when released", () => {
      it("leaves the owning tenant's lease untouched", async () => {
        const value = await lifecycle.encode({
          jobData: REDIS_TIER_PAYLOAD,
          groupId: TENANT_GROUP, // tenant proj1
        });
        await seedLease(value);
        const key = leaseKey(hashOf(value));
        expect(await redis.zcard(key)).toBe(1);

        // Release under a foreign group: the proj1 lease must NOT be dropped.
        await lifecycle.releaseLease({ values: [value], groupId: "proj2/agg" });

        // Wait long enough that an unguarded release would have reclaimed it.
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(await redis.zcard(key)).toBe(1);
        expect(await redis.exists(blobKey(hashOf(value)))).toBe(1);
      });
    });
  });

  describe("given a transfer whose new ref belongs to a different tenant", () => {
    describe("when transferred", () => {
      it("never takes the foreign lease (mirror of the release-side guard)", async () => {
        // Old value is tenant proj1's; new value is tenant proj2's. Under proj1's
        // group, the transfer must NOT take proj2's lease.
        const oldValue = await lifecycle.encode({
          jobData: REDIS_TIER_PAYLOAD,
          groupId: TENANT_GROUP, // proj1
        });
        const newValue = await lifecycle.encode({
          jobData: { bulk: "y".repeat(8 * 1024) },
          groupId: "proj2/agg",
        });
        const newHash = hashOf(newValue);
        const newLeaseKey = `${queueName}:gq:blobleases:proj2/${newHash}`;
        await seedLease(oldValue);
        const oldKey = leaseKey(hashOf(oldValue));
        expect(await redis.zcard(oldKey)).toBe(1);

        await lifecycle.transferLease({
          newValue,
          oldValue,
          groupId: TENANT_GROUP,
        });

        await new Promise((resolve) => setTimeout(resolve, 150));
        // proj2 lease must NOT have been created by the foreign-tenant transfer.
        expect(await redis.exists(newLeaseKey)).toBe(0);
        // proj1's lease was released through the guarded path.
        expect(await redis.zcard(oldKey)).toBe(0);
      });
    });
  });

  describe("given a same-content retry", () => {
    describe("when the lease is transferred to the re-encoded value", () => {
      it("swaps the holder identity on one lease set and keeps the blob", async () => {
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
        await seedLease(v1);
        expect(await redis.zcard(leaseKey(hash))).toBe(1);

        await lifecycle.transferLease({
          newValue: v2,
          oldValue: v1,
          groupId: TENANT_GROUP,
        });

        expect(await redis.zcard(leaseKey(hash))).toBe(1);
        expect(await redis.exists(blobKey(hash))).toBe(1);
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
        await seedLease(v1);
        const key = leaseKey(hashOf(v1));
        expect(await redis.zcard(key)).toBe(1);

        await lifecycle.transferLease({
          newValue: v2,
          oldValue: v1,
          groupId: TENANT_GROUP,
        });

        expect(await redis.zcard(key)).toBe(1);
        expect(await redis.exists(blobKey(hashOf(v1)))).toBe(1);
      });
    });
  });

  describe("given a dedup squash to different content", () => {
    describe("when the lease is transferred across blobs", () => {
      it("releases the displaced lease, takes the new one, and leaves reclaim lazy", async () => {
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
        await seedLease(vOld);
        expect(await redis.zcard(leaseKey(oldHash))).toBe(1);

        await lifecycle.transferLease({
          newValue: vNew,
          oldValue: vOld,
          groupId: TENANT_GROUP,
        });

        expect(await redis.exists(blobKey(oldHash))).toBe(1);
        expect(await redis.exists(leaseKey(oldHash))).toBe(0);
        expect(await redis.zcard(leaseKey(newHash))).toBe(1);
      });
    });
  });

  describe("given an s3-tier blob leased by one holder", () => {
    describe("when the holder releases", () => {
      it("leaves the object to the durable-store lifecycle sweep", async () => {
        const value = await lifecycle.encode({
          jobData: { bulk: incompressible(768 * 1024) }, // > 256 KiB gzipped → s3
          groupId: TENANT_GROUP,
        });
        expect(readEnvelopeLease(value)!.ref.tier).toBe("s3");
        expect(objectStore.store.size).toBe(1);
        await seedLease(value);

        await lifecycle.releaseLease({
          values: [value],
          groupId: TENANT_GROUP,
        });

        expect(objectStore.deleted).toHaveLength(0);
        expect(objectStore.store.size).toBe(1);
        expect(await redis.exists(leaseKey(hashOf(value)))).toBe(0);
      });
    });
  });

  describe("given a transfer where one side is not a GQ2 lease", () => {
    describe("when a GQ2 value replaces an inline value", () => {
      it("falls back to ordered lease take and release without throwing", async () => {
        const inlineValue = await lifecycle.encode({
          jobData: { small: 1 }, // under the inline ceiling → no lease
          groupId: TENANT_GROUP,
        });
        const gq2Value = await lifecycle.encode({
          jobData: REDIS_TIER_PAYLOAD,
          groupId: TENANT_GROUP,
        });
        expect(readEnvelopeLease(inlineValue)).toBeNull();
        expect(readEnvelopeLease(gq2Value)).not.toBeNull();

        await lifecycle.transferLease({
          newValue: gq2Value,
          oldValue: inlineValue,
          groupId: TENANT_GROUP,
        });

        expect(await redis.zcard(leaseKey(hashOf(gq2Value)))).toBe(1);
      });
    });
  });
});
