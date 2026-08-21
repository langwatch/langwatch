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
import type { EventSourcedQueueDefinition } from "../../queue.types";
import { GroupQueueProcessor } from "../groupQueue";
import type { ObjectStore } from "../tieredBlobStore";
import {
  FlakyObjectStore,
  InMemoryObjectStore,
  incompressible,
} from "./blobTestDoubles";

// Skip outside testcontainers (e.g. plain unit runs).
const hasTestcontainers = !!(
  process.env.TEST_CLICKHOUSE_URL ||
  process.env.CI_CLICKHOUSE_URL ||
  process.env.REDIS_URL ||
  process.env.CI_REDIS_URL
);

type TestPayload = {
  id: string;
  groupId: string;
  value: string;
  __jobType?: string;
  __jobName?: string;
};

// > the 4 KiB inline ceiling, < the 256 KiB s3 threshold → redis tier (inspectable).
const OFFLOADED_VALUE = "x".repeat(8 * 1024);
const TENANT_GROUP = "proj1/agg";

describe.skipIf(!hasTestcontainers)("GroupQueueProcessor — GQ2 offload", () => {
  let redis: Redis;
  let queues: GroupQueueProcessor<TestPayload>[];

  beforeAll(async () => {
    await startTestContainers();
    redis = getTestRedisConnection()!;
  });

  beforeEach(() => {
    vi.stubEnv("GROUP_QUEUE_ENVELOPE_WRITES_ENABLED", "true");
    queues = [];
  });

  afterEach(async () => {
    await Promise.all(queues.map((q) => q.close().catch(() => {})));
    // Scoped to this suite's hash-tagged namespace — never a global flushall,
    // which would race with parallel integration suites on the shared Redis.
    const keys = await redis.keys("{test/gq2/*");
    if (keys.length > 0) await redis.del(...keys);
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await stopTestContainers();
  });

  function createQueue({
    processFn,
    consumerEnabled,
    objectStore = new InMemoryObjectStore(),
    processBatch,
    coalesceMaxBatch,
    coalesceMaxBytes,
  }: {
    processFn: (payload: TestPayload) => Promise<void>;
    consumerEnabled: boolean;
    objectStore?: ObjectStore;
    processBatch?: (payloads: TestPayload[]) => Promise<void>;
    coalesceMaxBatch?: (payload: TestPayload) => number | undefined;
    coalesceMaxBytes?: (payload: TestPayload) => number | undefined;
  }): { queue: GroupQueueProcessor<TestPayload>; name: string } {
    const name = `{test/gq2/${crypto.randomUUID().slice(0, 8)}}`;
    const definition: EventSourcedQueueDefinition<TestPayload> = {
      name,
      groupKey: (p) => p.groupId,
      process: processFn,
      ...(processBatch ? { processBatch } : {}),
      ...(coalesceMaxBatch ? { coalesceMaxBatch } : {}),
      ...(coalesceMaxBytes ? { coalesceMaxBytes } : {}),
    };
    const queue = new GroupQueueProcessor<TestPayload>(definition, redis, {
      consumerEnabled,
      objectStoreFor: () => objectStore,
      resolveStorageDestination: async () => ({
        kind: "s3",
        bucket: "test-bucket",
      }),
    });
    queues.push(queue);
    return { queue, name };
  }

  const blobKeys = (name: string) => redis.keys(`${name}:gq:blob:*`);
  const leaseKeys = (name: string) => redis.keys(`${name}:gq:blobleases:*`);

  // The regression this guards (ADR-066 pillar 2): the drain's byte budget used
  // to measure the STORED value, which for an offloaded body is a ~250-byte
  // reference. A burst of megabyte payloads therefore folded whole no matter
  // what budget was set — the exact backlog the coalescing was built for was the
  // one where the byte bound stopped existing.
  describe("given a burst of jobs whose payloads are all offloaded", () => {
    describe("when a byte budget smaller than the burst is set", () => {
      /** @scenario an offloaded payload's reference advertises its true cost */
      it("bounds the batch by payload bytes, not by the reference's stored size", async () => {
        const batches: TestPayload[][] = [];
        const singles: TestPayload[] = [];
        const { queue } = createQueue({
          processFn: async (p) => {
            singles.push(p);
          },
          processBatch: async (ps) => {
            batches.push(ps);
          },
          consumerEnabled: true,
          // Count alone would fold all six; the budget fits two 8 KiB payloads.
          coalesceMaxBatch: () => 50,
          coalesceMaxBytes: () => 20 * 1024,
        });
        await queue.waitUntilReady();

        await queue.sendBatch(
          Array.from({ length: 6 }, (_, i) => ({
            id: `j${i}`,
            groupId: TENANT_GROUP,
            value: OFFLOADED_VALUE,
          })),
        );

        await vi.waitFor(
          () => {
            const total =
              batches.reduce((n, b) => n + b.length, 0) + singles.length;
            expect(total).toBe(6);
          },
          { timeout: 30000, interval: 50 },
        );

        // Six references sum to ~1.5 KiB, so the old accounting put the whole
        // burst inside a 20 KiB budget. Six 8 KiB payloads do not fit.
        const maxBatch =
          batches.length > 0 ? Math.max(...batches.map((b) => b.length)) : 0;
        // Exactly two, not "at most two": an upper bound alone also passes when
        // coalescing stops happening at all (maxBatch 0), which would be as
        // wrong as a six-wide batch. The budget fits two 8 KiB payloads, and
        // all six are staged before the consumer drains, so two is the answer.
        expect(maxBatch).toBe(2);
        // Every payload was still resolved in full, and delivered exactly once.
        const all = [...batches.flat(), ...singles];
        expect(new Set(all.map((p) => p.id)).size).toBe(6);
        expect(all.every((p) => p.value === OFFLOADED_VALUE)).toBe(true);
      });
    });
  });

  describe("given a job whose payload exceeds the inline ceiling", () => {
    describe("when it is processed to completion", () => {
      it("resolves the full payload, releases its lease, and leaves blob reclaim lazy", async () => {
        const received: TestPayload[] = [];
        const { queue, name } = createQueue({
          processFn: async (p) => {
            received.push(p);
          },
          consumerEnabled: true,
        });
        await queue.waitUntilReady();

        await queue.send({
          id: "j1",
          groupId: TENANT_GROUP,
          value: OFFLOADED_VALUE,
        });

        // Handler receives the full payload — proving it was offloaded then resolved.
        await vi.waitFor(() => expect(received).toHaveLength(1), {
          timeout: 5000,
          interval: 50,
        });
        expect(received[0]!.value).toBe(OFFLOADED_VALUE);

        // Completion removes only the lease. Redis expiry reclaims the blob lazily.
        await vi.waitFor(
          async () => {
            expect(await blobKeys(name)).toHaveLength(1);
            expect(await leaseKeys(name)).toHaveLength(0);
          },
          { timeout: 5000, interval: 50 },
        );
      });
    });
  });

  // The fan-out content-sharing invariant is proven at the encode level in
  // jobEnvelope.unit.test.ts ("when two envelopes have identical user payloads
  // but different queue machinery → ONE stored blob"). A queue-level end-to-end
  // proof requires multi-subscriber wiring (multiple subscriber definitions over one
  // event) — out of scope for this single-subscriber harness. Lease expiry and
  // idempotency are proven in blobLeases.integration.test.ts.
  describe("given an offloaded job", () => {
    describe("when it is staged", () => {
      it("keys the blob by tenant namespace and content hash", async () => {
        // No consumer: the job stays staged so we can inspect the blob key.
        const { queue, name } = createQueue({
          processFn: async () => {},
          consumerEnabled: false,
        });
        await queue.waitUntilReady();

        await queue.send({
          id: "j1",
          groupId: TENANT_GROUP,
          value: OFFLOADED_VALUE,
        });

        await vi.waitFor(
          async () => {
            const keys = await blobKeys(name);
            expect(keys).toHaveLength(1);
            // {queue}:gq:blob:<projectId>/<128-bit base64url hash>
            const prefix = `${name}:gq:blob:proj1/`;
            expect(keys[0]!.startsWith(prefix)).toBe(true);
            expect(keys[0]!.slice(prefix.length)).toMatch(
              /^[A-Za-z0-9_-]{22}$/,
            );
          },
          { timeout: 5000, interval: 50 },
        );
      });
    });
  });

  describe("given three jobs with identical offloaded content", () => {
    describe("when they are staged", () => {
      it("stores one blob and records one lease per job", async () => {
        const { queue, name } = createQueue({
          processFn: async () => {},
          consumerEnabled: false,
        });
        await queue.waitUntilReady();

        for (let i = 0; i < 3; i++) {
          await queue.send({
            id: "same-payload",
            groupId: TENANT_GROUP,
            value: OFFLOADED_VALUE,
            __jobType: "reactor",
            __jobName: `shared-payload-${i}`,
          });
        }

        await vi.waitFor(async () => {
          expect(await blobKeys(name)).toHaveLength(1);
          const keys = await leaseKeys(name);
          expect(keys).toHaveLength(1);
          expect(await redis.zcard(keys[0]!)).toBe(3);
          expect(
            await redis.zcard(`${name}:gq:group:${TENANT_GROUP}:jobs`),
          ).toBe(3);
        });
      });
    });
  });

  describe("given an s3-tier blob whose store fails transiently then recovers", () => {
    describe("when it is processed", () => {
      it("retries instead of dropping, and the handler eventually runs", async () => {
        const received: TestPayload[] = [];
        const flaky = new FlakyObjectStore(1); // fail the first get, then serve
        const { queue } = createQueue({
          processFn: async (p) => {
            received.push(p);
          },
          consumerEnabled: true,
          objectStore: flaky,
        });
        await queue.waitUntilReady();

        const big = incompressible(768 * 1024); // > 256 KiB gzipped → s3 tier
        await queue.send({ id: "s1", groupId: TENANT_GROUP, value: big });

        // First dispatch hits the transient failure and re-stages; the retry
        // (after backoff) finds the store recovered and runs the handler.
        await vi.waitFor(() => expect(received).toHaveLength(1), {
          timeout: 15000,
          interval: 100,
        });
        expect(received[0]!.value).toBe(big);
      }, 20000);
    });
  });

  describe("given a payload carrying a __* key in the reserved namespace", () => {
    describe("when sent", () => {
      it("rejects loudly so silent dedup collisions can't happen", async () => {
        const { queue } = createQueue({
          processFn: async () => {},
          consumerEnabled: false,
        });
        await queue.waitUntilReady();

        await expect(
          queue.send({
            id: "j1",
            groupId: TENANT_GROUP,
            value: "ok",
            // Testing a runtime guard.
            __custom: "this would collide on the content hash",
          } as any),
        ).rejects.toThrow(/__custom.*reserved/);
      });
    });

    describe("when the payload carries a caller-set routing field", () => {
      it("passes through (__pipelineName / __jobType / __jobName are caller-controlled, not queue-internal)", async () => {
        const { queue } = createQueue({
          processFn: async () => {},
          consumerEnabled: false,
        });
        await queue.waitUntilReady();

        await expect(
          queue.send({
            id: "j1",
            groupId: TENANT_GROUP,
            value: "ok",
            __pipelineName: "trace-processing",
            __jobType: "fold",
            __jobName: "recordSpan",
            // Routing fields aren't on TestPayload.
          } as any),
        ).resolves.toBeUndefined();
      });
    });

    describe("when sentBatch", () => {
      it("rejects if any payload in the batch carries a __* key", async () => {
        const { queue } = createQueue({
          processFn: async () => {},
          consumerEnabled: false,
        });
        await queue.waitUntilReady();

        await expect(
          queue.sendBatch([
            { id: "ok", groupId: TENANT_GROUP, value: "ok" },
            // Testing a runtime guard.
            {
              id: "bad",
              groupId: TENANT_GROUP,
              value: "bad",
              __sneaky: "x",
            } as any,
          ]),
        ).rejects.toThrow(/__sneaky.*reserved/);
      });
    });
  });
});
