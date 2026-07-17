import type { Redis } from "ioredis";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  getTestRedisConnection,
  startTestContainers,
  stopTestContainers,
} from "../../../__tests__/integration/testContainers";
import { readBlobLeaseSeconds } from "../blobConstants";
import { EnvelopeBlobLifecycle } from "../envelopeBlobLifecycle";
import { isEnvelope, splitEnvelope } from "../jobEnvelope";
import { incompressible, InMemoryObjectStore } from "./blobTestDoubles";

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
  });

  afterEach(async () => {
    // Scoped to this suite's hash-tagged namespace, not a global flushall.
    const keys = await redis.keys("{test/lifecycle/*");
    if (keys.length > 0) await redis.del(...keys);
  });

  afterAll(async () => {
    await stopTestContainers();
  });

  const blobKey = (hash: string) => `${queueName}:gq:blob:proj1/${hash}`;
  const hashOf = (value: string) => splitEnvelope(value).header.ref!.hash;

  describe("given a redis-tier payload", () => {
    it("offloads at encode with the lease TTL and round-trips on decode", async () => {
      const value = await lifecycle.encode({
        jobData: REDIS_TIER_PAYLOAD,
        groupId: TENANT_GROUP,
      });

      expect(isEnvelope(value)).toBe(true);
      const key = blobKey(hashOf(value));
      const ttlAtPut = await redis.ttl(key);
      expect(ttlAtPut).toBeGreaterThan(0);
      expect(ttlAtPut).toBeLessThanOrEqual(readBlobLeaseSeconds());

      const decoded = await lifecycle.decode({
        value,
        groupId: TENANT_GROUP,
      });
      expect(decoded).toEqual(REDIS_TIER_PAYLOAD);
    });

    it("renews the blob lease on every worker read (ADR-046)", async () => {
      const value = await lifecycle.encode({
        jobData: REDIS_TIER_PAYLOAD,
        groupId: TENANT_GROUP,
      });
      const key = blobKey(hashOf(value));
      // Simulate a blob deep into its lease.
      await redis.expire(key, 100);

      await lifecycle.decode({ value, groupId: TENANT_GROUP });

      expect(await redis.ttl(key)).toBeGreaterThan(100);
    });

    it("leaves the blob in place after decode — nothing eagerly reclaims", async () => {
      const value = await lifecycle.encode({
        jobData: REDIS_TIER_PAYLOAD,
        groupId: TENANT_GROUP,
      });
      const key = blobKey(hashOf(value));

      await lifecycle.decode({ value, groupId: TENANT_GROUP });
      await lifecycle.decode({ value, groupId: TENANT_GROUP });

      expect(await redis.exists(key)).toBe(1);
    });
  });

  describe("given an offloaded value decoded under a different tenant's group", () => {
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

  describe("given a re-encode with different queue machinery (the retry path)", () => {
    it("hashes identically — machinery doesn't perturb the content hash (routing-exclusion)", async () => {
      const first = await lifecycle.encode({
        jobData: {
          ...REDIS_TIER_PAYLOAD,
          __jobName: "reactorA",
          __attempt: 1,
        },
        groupId: TENANT_GROUP,
      });
      const second = await lifecycle.encode({
        jobData: {
          ...REDIS_TIER_PAYLOAD,
          __jobName: "reactorB",
          __attempt: 2,
        },
        groupId: TENANT_GROUP,
      });

      // Same content hash → same stored blob; the re-PUT renewed its lease.
      expect(hashOf(first)).toBe(hashOf(second));
      const blobKeys = await redis.keys(`${queueName}:gq:blob:*`);
      expect(blobKeys).toHaveLength(1);
    });
  });

  describe("given a group with no tenant prefix", () => {
    it("downgrades to an inline GQ2 body rather than offloading", async () => {
      const value = await lifecycle.encode({
        jobData: REDIS_TIER_PAYLOAD,
        groupId: "no-tenant-group",
      });

      expect(value.startsWith("GQ2|")).toBe(true);
      expect(splitEnvelope(value).header.ref).toBeUndefined();
      expect(await redis.keys(`${queueName}:gq:blob:*`)).toHaveLength(0);
      expect(
        await lifecycle.decode({ value, groupId: "no-tenant-group" }),
      ).toEqual(REDIS_TIER_PAYLOAD);
    });
  });

  describe("given an s3-tier payload", () => {
    it("stores the object once and never deletes it from the application", async () => {
      // Incompressible so the stored (compressed) bytes stay over the
      // 256 KiB s3 threshold.
      const big = { bulk: incompressible(400 * 1024) };
      const value = await lifecycle.encode({
        jobData: big,
        groupId: TENANT_GROUP,
      });

      expect(splitEnvelope(value).header.ref?.tier).toBe("s3");
      expect(objectStore.store.size).toBe(1);

      await lifecycle.decode({ value, groupId: TENANT_GROUP });
      await lifecycle.decode({ value, groupId: TENANT_GROUP });

      // Reclaim is the bucket lifecycle rule's job (ADR-046) — reads never
      // delete, and there is no application-side reclaim path at all.
      expect(objectStore.store.size).toBe(1);
    });
  });
});
