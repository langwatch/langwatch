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

type TestPayload = { id: string; groupId: string; value: string };

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
  }: {
    processFn: (payload: TestPayload) => Promise<void>;
    consumerEnabled: boolean;
    objectStore?: ObjectStore;
  }): { queue: GroupQueueProcessor<TestPayload>; name: string } {
    const name = `{test/gq2/${crypto.randomUUID().slice(0, 8)}}`;
    const definition: EventSourcedQueueDefinition<TestPayload> = {
      name,
      groupKey: (p) => p.groupId,
      process: processFn,
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
  const holderKeys = (name: string) => redis.keys(`${name}:gq:blobholders:*`);

  describe("given a job whose payload exceeds the inline ceiling", () => {
    describe("when it is processed to completion", () => {
      it("resolves the full payload on dispatch and reclaims the blob + holder", async () => {
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

        // The blob and its holder set are eagerly reclaimed once the last holder completes.
        await vi.waitFor(
          async () => {
            expect(await blobKeys(name)).toHaveLength(0);
            expect(await holderKeys(name)).toHaveLength(0);
          },
          { timeout: 5000, interval: 50 },
        );
      });
    });
  });

  // The fan-out content-sharing invariant is proven at the encode level in
  // jobEnvelope.unit.test.ts ("when two envelopes have identical user payloads
  // but different queue machinery → ONE stored blob"). A queue-level end-to-end
  // proof requires multi-reactor wiring (multiple reactor definitions over one
  // event) — out of scope for this single-reactor harness. The holder reclaim
  // sequence itself is proven in blobHolders.integration.test.ts.
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
            // biome-ignore lint/suspicious/noExplicitAny: testing a runtime guard
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
            // biome-ignore lint/suspicious/noExplicitAny: routing fields aren't on TestPayload
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
            // biome-ignore lint/suspicious/noExplicitAny: testing a runtime guard
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
