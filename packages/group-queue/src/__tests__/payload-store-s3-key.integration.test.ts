import IORedis, { type Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GroupQueueRuntimeDefinition } from "../contracts.ts";
import { GroupQueueProcessor } from "../groupQueue.ts";
import { InMemoryObjectStore, incompressible, mintTestUri } from "./blob-test-doubles.ts";

type TestPayload = { id: string; groupId: string; value: string };

const TENANT = "proj-s3-key";
const BUCKET = "test-bucket";

describe("GroupQueueProcessor — S3-tier key layout (ADR-172)", () => {
  let redis: Redis;
  let queues: GroupQueueProcessor<TestPayload>[];

  beforeAll(() => {
    redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 0,
    });
  });

  beforeEach(() => {
    vi.stubEnv("GROUP_QUEUE_ENVELOPE_WRITES_ENABLED", "true");
    queues = [];
  });

  afterEach(async () => {
    await Promise.all(queues.map((q) => q.close().catch(() => {})));
    const keys = await redis.keys("{test/gqs3key/*");
    if (keys.length > 0) await redis.del(...keys);
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await redis.quit();
  });

  describe("given a job whose shared payload exceeds the S3 threshold", () => {
    describe("when it is staged and a worker handles it", () => {
      /** @scenario "A very large payload offloads to S3 through the reused object store" */
      it("stores the body under group-queue/<projectId>/<hash> and delivers it intact", async () => {
        const name = `{test/gqs3key/${crypto.randomUUID().slice(0, 8)}}`;
        const objectStore = new InMemoryObjectStore();
        const received: TestPayload[] = [];
        const definition: GroupQueueRuntimeDefinition<TestPayload> = {
          name,
          groupKey: (p) => p.groupId,
          identify: (p) => p.id,
          process: async (payload) => {
            received.push(payload);
          },
        };
        const queue = new GroupQueueProcessor<TestPayload>(definition, redis, {
          consumerEnabled: true,
          objectStoreFor: () => objectStore,
          mintUri: mintTestUri,
          resolveStorageDestination: async () => ({ kind: "s3" as const, bucket: BUCKET }),
        });
        queues.push(queue);
        await queue.waitUntilReady();

        const value = incompressible(768 * 1024);
        await queue.send({ id: "big", groupId: `${TENANT}/g1`, value });

        await vi.waitFor(() => expect(received).toHaveLength(1), {
          timeout: 15000,
          interval: 100,
        });
        expect(received[0]!.value).toBe(value);

        const keys = [...objectStore.store.keys()];
        expect(keys).toHaveLength(1);
        expect(keys[0]).toMatch(
          new RegExp(`^s3://${BUCKET}/group-queue/${TENANT}/[A-Za-z0-9_-]{22}$`),
        );
        // Completion releases the lease but deletes nothing (lifecycle rule reclaims).
        await vi.waitFor(
          async () => expect(await redis.keys(`${name}:gq:blobleases:*`)).toEqual([]),
          {
            timeout: 5000,
            interval: 100,
          },
        );
        expect(objectStore.deleted).toEqual([]);
        expect(objectStore.store.size).toBe(1);
      });
    });
  });
});
