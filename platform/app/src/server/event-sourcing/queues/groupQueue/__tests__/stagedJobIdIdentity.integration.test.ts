import type { Readable } from "node:stream";

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

import { QueueRedisRepository } from "~/server/app-layer/ops/repositories/queue.redis.repository";
import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import {
  getTestRedisConnection,
  startTestContainers,
  stopTestContainers,
} from "../../../__tests__/integration/testContainers";
import type {
  EventSourcedQueueDefinition,
  JobDelivery,
} from "../../queue.types";
import { JOB_RETRY_CONFIG } from "../../shared";
import { GroupQueueProcessor } from "../groupQueue";
import {
  encodeJobEnvelope,
  readJobAttempt,
  withJobAttempt,
} from "../jobEnvelope";
import { gqJobsDroppedTotal } from "../metrics";
import {
  DEFAULT_CLAIM_STRIKE_THRESHOLD,
  GroupStagingScripts,
} from "../scripts";
import { TieredBlobStore } from "../tieredBlobStore";
import {
  InMemoryJobBlobStore,
  InMemoryObjectStore,
  incompressible,
} from "./blobTestDoubles";

// Skip outside testcontainers (e.g. plain unit runs) — mirrors the other
// groupQueue integration suites (groupQueue.poisonGuard/decodeDrop).
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
  // Caller-controlled routing fields (allowed through the __* guard).
  __pipelineName?: string;
  __jobType?: string;
  __jobName?: string;
};

/** Tenant prefix on groupIds so GQ2 (content-addressed, tenant-namespaced) engages. */
const TENANT = "proj1";
const PROJECT = createTenantId(TENANT);
const STORAGE_DESTINATION = async () => ({
  kind: "s3" as const,
  bucket: "test-bucket",
});

/** > the 256 KiB s3 threshold once gzipped (see groupQueue.gq2.integration.test.ts). */
const OFFLOADABLE_S3_VALUE = () => incompressible(768 * 1024);

describe.skipIf(!hasTestcontainers)(
  "GroupQueueProcessor — a staged job id is identity, not state (ADR-080)",
  () => {
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
      vi.restoreAllMocks();
      // Scoped to this suite's hash-tagged namespace — never a global flushall,
      // which would race with parallel integration suites on the shared Redis.
      const keys = await redis.keys("{test/gqid/*");
      if (keys.length > 0) await redis.del(...keys);
      vi.unstubAllEnvs();
    });

    afterAll(async () => {
      await stopTestContainers();
    });

    function freshName(): string {
      return `{test/gqid/${crypto.randomUUID().slice(0, 8)}}`;
    }

    function newQueue({
      name,
      processFn,
      consumerEnabled,
      objectStore,
      processBatch,
      coalesceMaxBatch,
    }: {
      name: string;
      processFn: (
        payload: TestPayload,
        delivery?: JobDelivery,
      ) => Promise<void>;
      consumerEnabled: boolean;
      objectStore: InMemoryObjectStore;
      processBatch?: (
        payloads: TestPayload[],
        delivery?: JobDelivery,
      ) => Promise<void>;
      coalesceMaxBatch?: (payload: TestPayload) => number | undefined;
    }): GroupQueueProcessor<TestPayload> {
      const definition: EventSourcedQueueDefinition<TestPayload> = {
        name,
        groupKey: (p) => p.groupId,
        process: processFn,
        ...(processBatch ? { processBatch } : {}),
        ...(coalesceMaxBatch ? { coalesceMaxBatch } : {}),
      };
      const queue = new GroupQueueProcessor<TestPayload>(definition, redis, {
        consumerEnabled,
        objectStoreFor: () => objectStore,
        resolveStorageDestination: STORAGE_DESTINATION,
      });
      queues.push(queue);
      return queue;
    }

    // --- Redis inspection -------------------------------------------------

    const jobsKey = (name: string, groupId: string) =>
      `${name}:gq:group:${groupId}:jobs`;
    const dataKey = (name: string, groupId: string) =>
      `${name}:gq:group:${groupId}:data`;
    const attemptKey = (name: string, groupId: string) =>
      `${name}:gq:group:${groupId}:attempt`;
    const failStreakKey = (name: string, groupId: string) =>
      `${name}:gq:group:${groupId}:failstreak`;
    const strikesKey = (name: string, groupId: string) =>
      `${name}:gq:group:${groupId}:strikes`;
    const activeKey = (name: string, groupId: string) =>
      `${name}:gq:group:${groupId}:active`;

    const stagedIds = (name: string, groupId: string) =>
      redis.zrange(jobsKey(name, groupId), 0, -1);
    const stagedScore = (name: string, groupId: string, stagedJobId: string) =>
      redis.zscore(jobsKey(name, groupId), stagedJobId);
    const stagedValue = (name: string, groupId: string, stagedJobId: string) =>
      redis.hget(dataKey(name, groupId), stagedJobId);
    const groupAttempt = (name: string, groupId: string) =>
      redis.get(attemptKey(name, groupId));
    const failStreak = (name: string, groupId: string) =>
      redis.get(failStreakKey(name, groupId));
    const blockedMembers = (name: string) =>
      redis.smembers(`${name}:gq:blocked`);
    const readyScore = (name: string, groupId: string) =>
      redis.zscore(`${name}:gq:ready`, groupId);
    const totalPending = (name: string) =>
      redis.get(`${name}:gq:stats:total-pending`);

    async function dropsFor(name: string) {
      const metric = await gqJobsDroppedTotal.get();
      return metric.values.filter((v) => v.labels.queue_name === name);
    }

    /** The id `generateStagedJobId` derives for a routed payload. */
    const expectedStagedId = (p: TestPayload) =>
      `${p.id}/${p.__jobType!}/${p.__jobName!}`;

    /** Serves puts, but every read is a network-class failure (never "gone"). */
    class UnreachableObjectStore extends InMemoryObjectStore {
      override async get(): Promise<Readable> {
        throw new Error("transient ECONNRESET");
      }
    }

    /**
     * Stages an already-encoded GQ2 s3-tier job under a caller-chosen id,
     * bypassing `send()` so the id (and the attempt on its message) is exactly
     * what the test wants. Mirrors decodeDrop's crafted-stage helper.
     */
    async function stageOffloadedUnder({
      name,
      groupId,
      stagedJobId,
      objectStore,
      attempt,
      routing,
    }: {
      name: string;
      groupId: string;
      stagedJobId: string;
      objectStore: InMemoryObjectStore;
      attempt?: number;
      routing?: Pick<TestPayload, "__pipelineName" | "__jobType" | "__jobName">;
    }): Promise<void> {
      const tiered = new TieredBlobStore({
        redisBlobs: new InMemoryJobBlobStore(),
        objectStoreFor: () => objectStore,
        resolveDestination: STORAGE_DESTINATION,
      });
      const envelope = await encodeJobEnvelope({
        jobData: {
          id: stagedJobId,
          groupId,
          value: OFFLOADABLE_S3_VALUE(),
          ...routing,
        },
        tieredBlobs: tiered,
        projectId: PROJECT,
        writesEnabled: true,
        queueName: name,
      });
      const scripts = new GroupStagingScripts(redis, name);
      await scripts.stageBatch([
        {
          stagedJobId,
          groupId,
          dispatchAfterMs: Date.now(),
          dedupId: "",
          dedupTtlMs: 0,
          jobDataJson:
            attempt === undefined
              ? envelope
              : withJobAttempt({ value: envelope, attempt }),
        },
      ]);
    }

    // --- Late-heartbeat probe ---------------------------------------------

    type IntervalId = ReturnType<typeof setInterval>;

    /**
     * Records every interval the code under test arms so a test can tick them
     * at a chosen moment, and drops a handle the moment the implementation
     * clears it. Real timers stay in play — nothing here fakes the clock; the
     * probe only fires callbacks the implementation has LEFT armed.
     *
     * The cast is to the global's own signature: there is no exported seam for
     * "which intervals are currently armed", and the whole point of ADR-080's
     * heartbeat ordering is that the interval is gone before the re-stage is
     * issued.
     */
    function captureArmedIntervals(): {
      fireArmed: () => void;
      restore: () => void;
    } {
      const armed = new Map<IntervalId, () => void>();
      const realSetInterval = globalThis.setInterval;
      const realClearInterval = globalThis.clearInterval;

      globalThis.setInterval = ((
        callback: (...cbArgs: unknown[]) => void,
        ms?: number,
        ...args: unknown[]
      ): IntervalId => {
        const id = realSetInterval(callback, ms, ...args);
        armed.set(id, () => callback(...args));
        return id;
      }) as typeof setInterval;

      globalThis.clearInterval = ((id?: IntervalId): void => {
        if (id !== undefined) armed.delete(id);
        realClearInterval(id);
      }) as typeof clearInterval;

      return {
        fireArmed: () => {
          for (const tick of [...armed.values()]) tick();
        },
        restore: () => {
          globalThis.setInterval = realSetInterval;
          globalThis.clearInterval = realClearInterval;
        },
      };
    }

    /**
     * Ticks every still-armed interval at the WORST moment ADR-080 describes:
     * the re-stage has been sent and the worker is still tidying up. A beat
     * that lands there names an id the re-stage has just re-used, so
     * `REFRESH_LUA` matches and stretches a sub-second backoff into the full
     * active window (the worker's heartbeat is armed for the life of the job,
     * at `activeTtlSec / 3`).
     */
    function lateHeartbeatProbe(
      afterRestage?: (args: {
        groupId: string;
        stagedJobId: string;
      }) => Promise<void>,
    ) {
      const intervals = captureArmedIntervals();
      const refreshed: string[] = [];
      const settling: Promise<unknown>[] = [];

      const realRefresh = GroupStagingScripts.prototype.refreshActiveKey;
      vi.spyOn(
        GroupStagingScripts.prototype,
        "refreshActiveKey",
      ).mockImplementation(function (
        this: GroupStagingScripts,
        args: Parameters<typeof realRefresh>[0],
      ) {
        refreshed.push(args.stagedJobId);
        const running = realRefresh.call(this, args);
        settling.push(running.catch(() => false));
        return running;
      });

      const realRestage = GroupStagingScripts.prototype.retryRestage;
      const beats = { beforeTick: 0, afterRestage: 0 };
      vi.spyOn(
        GroupStagingScripts.prototype,
        "retryRestage",
      ).mockImplementation(async function (
        this: GroupStagingScripts,
        args: Parameters<typeof realRestage>[0],
      ) {
        const result = await realRestage.call(this, args);
        beats.beforeTick = refreshed.length;
        intervals.fireArmed();
        await Promise.all(settling);
        beats.afterRestage = refreshed.length - beats.beforeTick;
        await afterRestage?.({
          groupId: args.groupId,
          stagedJobId: args.newStagedJobId,
        });
        return result;
      });

      return {
        beats,
        refreshed,
        fireArmed: intervals.fireArmed,
        restore: intervals.restore,
      };
    }

    // ======================================================================
    // Rule: A staged job keeps one id from the moment it is sent
    // ======================================================================

    describe("given a job sent for an event", () => {
      describe("when its staged id is derived", () => {
        /** @scenario A job's staged id names the event and the job, and nothing else */
        it("names the event, the job type and the job name and stops there", async () => {
          const name = freshName();
          const groupId = `${TENANT}/id-shape`;
          const queue = newQueue({
            name,
            processFn: async () => {},
            consumerEnabled: false,
            objectStore: new InMemoryObjectStore(),
          });
          await queue.waitUntilReady();

          const payload: TestPayload = {
            id: "event_000649zPnIW3V0Ug6yVk9DECNYK3S",
            groupId,
            value: "x",
            __jobType: "subscriber",
            __jobName: "pm:langyConversation",
          };
          await queue.send(payload);

          const ids = await stagedIds(name, groupId);
          expect(ids).toEqual([
            "event_000649zPnIW3V0Ug6yVk9DECNYK3S/subscriber/pm:langyConversation",
          ]);
          // Pre-ADR-080 an id gained `/r/<n>` per retry and a `/r/<Date.now()>`
          // on the terminal restage; nothing mints either shape any more.
          expect(ids[0]).not.toMatch(/\/r\//);
          expect(ids[0]).not.toMatch(/\/p\//);
          expect(ids[0]).not.toMatch(/\d{13}/);
          // The value is stored under the very same key, so the id a producer
          // can predict is the one that looks the job up.
          expect(await stagedValue(name, groupId, ids[0]!)).not.toBeNull();
        });
      });
    });

    describe("given a claimed job that fails with a retryable error", () => {
      describe("when the queue re-stages it with backoff", () => {
        /** @scenario A retried job is re-staged under the id it was dispatched under */
        it("re-stages it under the id it was dispatched under, unchanged", async () => {
          const name = freshName();
          const groupId = `${TENANT}/retry-id`;
          const seen: number[] = [];
          const queue = newQueue({
            name,
            processFn: async (_p, delivery) => {
              seen.push(delivery?.attempt ?? 0);
              throw new Error("downstream blip");
            },
            consumerEnabled: true,
            objectStore: new InMemoryObjectStore(),
          });
          await queue.waitUntilReady();

          const payload: TestPayload = {
            id: "event_retry",
            groupId,
            value: "x",
            __jobType: "subscriber",
            __jobName: "pm:langyConversation",
          };
          await queue.send(payload);

          await vi.waitFor(() => expect(seen).toHaveLength(1), {
            timeout: 10000,
            interval: 25,
          });
          await vi.waitFor(
            async () => {
              expect(await stagedIds(name, groupId)).toHaveLength(1);
            },
            { timeout: 10000, interval: 25 },
          );

          // Pre-ADR-080 this read `event_retry/subscriber/pm:langyConversation/r/1`.
          expect(await stagedIds(name, groupId)).toEqual([
            expectedStagedId(payload),
          ]);
          expect(
            Object.keys(await redis.hgetall(dataKey(name, groupId))),
          ).toEqual([expectedStagedId(payload)]);
        }, 30000);
      });
    });

    describe("given a claimed job that has used up its retry budget", () => {
      describe("when the queue blocks the group and re-stages the job for inspection", () => {
        /** @scenario A job blocked after exhausting its retries keeps its staged id */
        it("re-stages it under the id it was dispatched under, unchanged", async () => {
          const name = freshName();
          const groupId = `${TENANT}/exhausted-id`;
          const queue = newQueue({
            name,
            processFn: async () => {
              throw new Error("downstream always down");
            },
            consumerEnabled: true,
            objectStore: new InMemoryObjectStore(),
          });
          await queue.waitUntilReady();

          // The group's retry chain already reads "budget spent", so the very
          // first claim takes the exhaustion branch — no 25-rung real ladder.
          await redis.set(
            attemptKey(name, groupId),
            String(JOB_RETRY_CONFIG.maxAttempts),
          );

          const payload: TestPayload = {
            id: "event_exhausted",
            groupId,
            value: "x",
            __jobType: "subscriber",
            __jobName: "pm:langyConversation",
          };
          await queue.send(payload);

          await vi.waitFor(
            async () => {
              expect(await blockedMembers(name)).toContain(groupId);
            },
            { timeout: 15000, interval: 50 },
          );

          // Pre-ADR-080 `handleExhaustedRetries` appended `/r/<Date.now()>`, so
          // the parked job could not be found by the id its producer knows.
          expect(await stagedIds(name, groupId)).toEqual([
            expectedStagedId(payload),
          ]);
        }, 30000);
      });
    });

    describe("given a claimed job whose group trips the poison guard", () => {
      describe("when the queue parks the group with the value intact", () => {
        /** @scenario A group parked by the poison guard keeps the staged id it parked on */
        it("re-stages the value under the id it was dispatched under, unchanged", async () => {
          const name = freshName();
          const groupId = `${TENANT}/parked-id`;
          const processed = vi.fn<(p: TestPayload) => Promise<void>>();
          processed.mockResolvedValue(undefined);
          const queue = newQueue({
            name,
            processFn: processed,
            consumerEnabled: true,
            objectStore: new InMemoryObjectStore(),
          });
          await queue.waitUntilReady();

          // Strikes left by prior claims whose process died — the crash-loop
          // signature the claim-side guard parks on.
          await redis.set(
            strikesKey(name, groupId),
            String(DEFAULT_CLAIM_STRIKE_THRESHOLD),
          );

          const payload: TestPayload = {
            id: "event_parked",
            groupId,
            value: "x",
            __jobType: "subscriber",
            __jobName: "pm:langyConversation",
          };
          await queue.send(payload);

          await vi.waitFor(
            async () => {
              expect(await blockedMembers(name)).toContain(groupId);
            },
            { timeout: 15000, interval: 50 },
          );

          expect(processed).not.toHaveBeenCalled();
          // Pre-ADR-080 the park appended `/p/<Date.now()>`.
          expect(await stagedIds(name, groupId)).toEqual([
            expectedStagedId(payload),
          ]);
        }, 30000);
      });
    });

    describe("given a job that fails on every attempt in its retry budget", () => {
      describe("when the ladder runs to its end and the group is blocked", () => {
        /** @scenario A job that rides the whole retry ladder ends under the id it started with */
        it("leaves it in staging under the id it was first sent with", async () => {
          const name = freshName();
          const groupId = `${TENANT}/whole-ladder`;
          const seen: number[] = [];
          const queue = newQueue({
            name,
            processFn: async (_p, delivery) => {
              seen.push(delivery?.attempt ?? 0);
              throw new Error("downstream always down");
            },
            consumerEnabled: true,
            objectStore: new InMemoryObjectStore(),
          });
          await queue.waitUntilReady();

          const payload: TestPayload = {
            id: "event_ladder",
            groupId,
            value: "x",
            __jobType: "subscriber",
            __jobName: "pm:langyConversation",
          };
          await queue.send(payload);

          // Two real rungs first, so the id is observed surviving genuine
          // re-stages rather than only the terminal.
          await vi.waitFor(
            async () => {
              expect(await groupAttempt(name, groupId)).toBe("3");
            },
            { timeout: 25000, interval: 25 },
          );
          expect(await stagedIds(name, groupId)).toEqual([
            expectedStagedId(payload),
          ]);

          // Then jump the chain to the end of the budget rather than sitting
          // through 25 exponential rungs (~2h27m of real backoff).
          await redis.set(
            attemptKey(name, groupId),
            String(JOB_RETRY_CONFIG.maxAttempts),
          );

          await vi.waitFor(
            async () => {
              expect(await blockedMembers(name)).toContain(groupId);
            },
            { timeout: 25000, interval: 50 },
          );

          expect(seen.slice(0, 2)).toEqual([1, 2]);
          expect(await stagedIds(name, groupId)).toEqual([
            expectedStagedId(payload),
          ]);
          // An operator can find it by the id the producer knows: the same
          // string keys the stored value.
          expect(
            await stagedValue(name, groupId, expectedStagedId(payload)),
          ).not.toBeNull();
        }, 90000);
      });
    });

    // ======================================================================
    // Rule: Re-staging a job under its own id conserves the queue-depth count
    // ======================================================================

    describe("given a job waiting out its retry backoff", () => {
      /**
       * Seeds the group's chain so the first failure lands on a rung whose
       * backoff is seconds wide — a real window to redeliver into, without
       * climbing there one 500ms rung at a time.
       */
      async function failOnceIntoALongBackoff({
        name,
        groupId,
        chainAt,
        onDelivery,
      }: {
        name: string;
        groupId: string;
        chainAt: number;
        onDelivery: (delivery: JobDelivery | undefined) => void;
      }): Promise<{
        queue: GroupQueueProcessor<TestPayload>;
        payload: TestPayload;
      }> {
        const queue = newQueue({
          name,
          processFn: async (_p, delivery) => {
            onDelivery(delivery);
            throw new Error("downstream blip");
          },
          consumerEnabled: true,
          objectStore: new InMemoryObjectStore(),
        });
        await queue.waitUntilReady();
        await redis.set(attemptKey(name, groupId), String(chainAt));

        const payload: TestPayload = {
          id: "event_redelivered",
          groupId,
          value: "x",
          __jobType: "subscriber",
          __jobName: "pm:langyConversation",
        };
        await queue.send(payload);
        await vi.waitUntil(
          async () =>
            (await stagedIds(name, groupId)).length === 1 &&
            (await groupAttempt(name, groupId)) === String(chainAt + 1),
          { timeout: 20000, interval: 25 },
        );
        return { queue, payload };
      }

      describe("when the same event is delivered again", () => {
        /** @scenario A redelivery of an event already waiting to retry does not double the queue depth */
        it("holds one job for that event and keeps the depth equal to what is staged", async () => {
          const name = freshName();
          const groupId = `${TENANT}/redelivery-depth`;
          const seen: number[] = [];
          const { queue, payload } = await failOnceIntoALongBackoff({
            name,
            groupId,
            chainAt: 5,
            onDelivery: (d) => seen.push(d?.attempt ?? 0),
          });

          await queue.send(payload);

          // Pre-ADR-080 the retry re-staged under `<id>/r/5`, so a redelivery
          // under `<id>` landed on a DIFFERENT member: two jobs for one event.
          expect(await stagedIds(name, groupId)).toEqual([
            expectedStagedId(payload),
          ]);
          expect(Number(await totalPending(name))).toBe(
            await redis.zcard(jobsKey(name, groupId)),
          );
          expect(await redis.zcard(jobsKey(name, groupId))).toBe(1);
          expect(seen).toEqual([5]);
        }, 45000);
      });

      describe("when the same event is delivered again and overwrites its message", () => {
        /** @scenario A redelivery that overwrites a waiting job's message does not reset its ladder */
        it("counts the next failure from where the ladder had reached", async () => {
          const name = freshName();
          const groupId = `${TENANT}/redelivery-ladder`;
          const seen: number[] = [];
          const { queue, payload } = await failOnceIntoALongBackoff({
            name,
            groupId,
            chainAt: 5,
            onDelivery: (d) => seen.push(d?.attempt ?? 0),
          });

          await queue.send(payload);
          // The redelivery really did overwrite the waiting job's message: it
          // is a fresh envelope that no longer records an attempt at all.
          const overwritten = await stagedValue(
            name,
            groupId,
            expectedStagedId(payload),
          );
          expect(readJobAttempt(overwritten!)).toBeNull();

          await vi.waitFor(() => expect(seen).toHaveLength(2), {
            timeout: 30000,
            interval: 25,
          });
          // The chain, not the message, is what the ladder counts from — so
          // the redelivery does not hand the job a fresh budget.
          expect(seen[1]).toBe(6);
          await vi.waitFor(
            async () => {
              expect(await groupAttempt(name, groupId)).toBe("7");
            },
            { timeout: 10000, interval: 25 },
          );
        }, 60000);
      });

      describe("when the same event is delivered again before the backoff expires", () => {
        /** @scenario A redelivery arriving mid-backoff does not shorten the wait */
        it("keeps the wait on the group's hold rather than the job's queue position", async () => {
          const name = freshName();
          const groupId = `${TENANT}/redelivery-wait`;
          const seen: number[] = [];
          const { queue, payload } = await failOnceIntoALongBackoff({
            name,
            groupId,
            chainAt: 5,
            onDelivery: (d) => seen.push(d?.attempt ?? 0),
          });
          const stagedJobId = expectedStagedId(payload);
          const backoffDeadline = Number(await readyScore(name, groupId));
          expect(backoffDeadline).toBeGreaterThan(Date.now());

          await queue.send(payload);

          // The redelivery pulled the job's OWN position forward to now...
          expect(
            Number(await stagedScore(name, groupId, stagedJobId)),
          ).toBeLessThan(backoffDeadline);
          // ...but the group's hold is untouched: the ready score still names
          // the backoff deadline and the active key still locks the group.
          expect(Number(await readyScore(name, groupId))).toBe(backoffDeadline);
          expect(await redis.pttl(activeKey(name, groupId))).toBeGreaterThan(0);

          // And nothing runs before the backoff was due.
          await new Promise((resolve) => setTimeout(resolve, 3000));
          expect(seen).toEqual([5]);
          expect(Date.now()).toBeLessThan(backoffDeadline);
        }, 60000);
      });
    });

    // ======================================================================
    // Rule: A retry waits the backoff it was given, not the active-slot timeout
    // ======================================================================

    describe("given a claimed job being re-staged for a retry", () => {
      describe("when the worker publishes the re-stage and finishes its bookkeeping", () => {
        /** @scenario No heartbeat is sent after a job's re-stage has been sent */
        it("sends no further heartbeat for that job", async () => {
          const name = freshName();
          const groupId = `${TENANT}/no-late-beat`;
          const probe = lateHeartbeatProbe();
          try {
            let failures = 0;
            const queue = newQueue({
              name,
              processFn: async () => {
                // A beat WHILE the job runs is legitimate — and it is also the
                // control that proves this probe can see one at all.
                probe.fireArmed();
                failures++;
                throw new Error("downstream blip");
              },
              consumerEnabled: true,
              objectStore: new InMemoryObjectStore(),
            });
            await queue.waitUntilReady();
            await queue.send({
              id: "event_beat",
              groupId,
              value: "x",
              __jobType: "subscriber",
              __jobName: "pm:langyConversation",
            });

            await vi.waitFor(
              () => expect(probe.beats.beforeTick).toBeGreaterThan(0),
              {
                timeout: 15000,
                interval: 25,
              },
            );
            expect(failures).toBeGreaterThan(0);
            // Control: the heartbeat WAS armed and the probe did observe it.
            expect(probe.refreshed).toContain(
              "event_beat/subscriber/pm:langyConversation",
            );
            // Pre-ADR-080 the interval was cleared only in the worker's outer
            // `finally`, so ticking it here produced another REFRESH — one that
            // now matches, because the re-stage reuses the id.
            expect(probe.beats.afterRestage).toBe(0);
          } finally {
            probe.restore();
          }
        }, 40000);
      });
    });

    describe("given a claimed job whose outcome has been decided", () => {
      describe("when the worker's remaining bookkeeping runs", () => {
        /** @scenario A worker's heartbeat stops extending a group's hold once the job's outcome is decided */
        it("leaves the group's hold at what the outcome asked for", async () => {
          const name = freshName();
          const groupId = `${TENANT}/hold-not-extended`;
          const observed: { activePttl: number; ready: number }[] = [];
          const probe = lateHeartbeatProbe(async ({ groupId: gid }) => {
            observed.push({
              activePttl: await redis.pttl(activeKey(name, gid)),
              ready: Number(await readyScore(name, gid)),
            });
          });
          try {
            const queue = newQueue({
              name,
              processFn: async () => {
                probe.fireArmed();
                throw new Error("downstream blip");
              },
              consumerEnabled: true,
              objectStore: new InMemoryObjectStore(),
            });
            await queue.waitUntilReady();
            const sentAt = Date.now();
            await queue.send({
              id: "event_hold",
              groupId,
              value: "x",
              __jobType: "subscriber",
              __jobName: "pm:langyConversation",
            });

            await vi.waitFor(() => expect(observed).not.toHaveLength(0), {
              timeout: 15000,
              interval: 25,
            });

            // The first attempt's backoff is 500ms, so the outcome asked for a
            // ~3s hold (backoff + the script's 2s buffer). A late beat would
            // have set it to the full 300s active window and pushed the ready
            // score out to match — a multi-minute stall on a half-second wait.
            const [first] = observed;
            expect(first!.activePttl).toBeGreaterThan(0);
            expect(first!.activePttl).toBeLessThanOrEqual(4000);
            expect(first!.ready).toBeLessThan(sentAt + 30000);
          } finally {
            probe.restore();
          }
        }, 40000);
      });
    });

    describe("given a claimed job that fails with a short retry backoff", () => {
      describe("when it is re-staged and the worker finishes its bookkeeping", () => {
        /** @scenario A retried job is dispatched when its backoff expires, not an active window later */
        it("becomes eligible again when the backoff expires", async () => {
          const name = freshName();
          const groupId = `${TENANT}/backoff-eligible`;
          const probe = lateHeartbeatProbe();
          try {
            const deliveries: number[] = [];
            const queue = newQueue({
              name,
              processFn: async (_p, delivery) => {
                probe.fireArmed();
                deliveries.push(delivery?.attempt ?? 0);
                if (deliveries.length === 1) throw new Error("downstream blip");
              },
              consumerEnabled: true,
              objectStore: new InMemoryObjectStore(),
            });
            await queue.waitUntilReady();
            await queue.send({
              id: "event_eligible",
              groupId,
              value: "x",
              __jobType: "subscriber",
              __jobName: "pm:langyConversation",
            });

            // The retry runs on its ~3s hold. Pre-ADR-080 the beat ticked after
            // the re-stage pushed the hold (and the ready score) to the full
            // 300s active window, so nothing would run inside this timeout.
            await vi.waitFor(() => expect(deliveries).toEqual([1, 2]), {
              timeout: 25000,
              interval: 25,
            });
          } finally {
            probe.restore();
          }
        }, 40000);
      });
    });

    // ======================================================================
    // Rule: Unblocking a group clears every counter that outlived the block
    // ======================================================================

    describe("given a group blocked after a job used up its retry budget", () => {
      describe("when an operator unblocks it and the job fails once more", () => {
        /** @scenario A group unblocked after exhaustion retries instead of re-blocking on its first failure */
        it("retries the job rather than blocking the group again", async () => {
          const name = freshName();
          const groupId = `${TENANT}/unblock-chain`;
          const seen: number[] = [];
          const queue = newQueue({
            name,
            processFn: async (_p, delivery) => {
              seen.push(delivery?.attempt ?? 0);
              throw new Error("downstream always down");
            },
            consumerEnabled: true,
            objectStore: new InMemoryObjectStore(),
          });
          await queue.waitUntilReady();
          await redis.set(
            attemptKey(name, groupId),
            String(JOB_RETRY_CONFIG.maxAttempts),
          );
          await queue.send({
            id: "event_unblock",
            groupId,
            value: "x",
            __jobType: "subscriber",
            __jobName: "pm:langyConversation",
          });

          await vi.waitFor(
            async () => {
              expect(await blockedMembers(name)).toContain(groupId);
            },
            { timeout: 20000, interval: 50 },
          );
          // The counter that decides whether trying is allowed outlived the
          // block — this is the state the operator is about to reset.
          expect(await groupAttempt(name, groupId)).toBe(
            String(JOB_RETRY_CONFIG.maxAttempts),
          );

          const ops = new QueueRedisRepository(redis);
          const { wasBlocked } = await ops.unblockGroup({
            queueName: name,
            groupId,
          });
          expect(wasBlocked).toBe(true);
          expect(await groupAttempt(name, groupId)).toBeNull();

          await vi.waitFor(() => expect(seen).toHaveLength(2), {
            timeout: 20000,
            interval: 25,
          });
          // Pre-ADR-080 the chain survived the unblock, so this run read as
          // attempt 25 and the group re-blocked on its very first failure.
          expect(seen[1]).toBe(1);
          expect(await blockedMembers(name)).not.toContain(groupId);
          await vi.waitFor(
            async () => {
              expect(await groupAttempt(name, groupId)).toBe("2");
            },
            { timeout: 10000, interval: 25 },
          );
        }, 60000);
      });
    });

    describe("given a group blocked after a long run of consecutive failures", () => {
      describe("when an operator unblocks it and its next job fails once", () => {
        /** @scenario A group unblocked after exhaustion is not immediately re-quarantined by its old failure streak */
        it("does not quarantine the group on that single failure", async () => {
          const ENV = "LANGWATCH_GQ_QUARANTINE_FAILSTREAK_THRESHOLD";
          vi.stubEnv(ENV, "3");
          const name = freshName();
          const groupId = `${TENANT}/unblock-streak`;
          const seen: number[] = [];
          const queue = newQueue({
            name,
            processFn: async (_p, delivery) => {
              seen.push(delivery?.attempt ?? 0);
              throw new Error("downstream always down");
            },
            consumerEnabled: true,
            objectStore: new InMemoryObjectStore(),
          });
          await queue.waitUntilReady();
          // A run of failures that stops one short of the quarantine threshold,
          // on a group whose retry budget is already spent — so it parks by
          // exhaustion, the path that never cleared the streak.
          await redis.set(failStreakKey(name, groupId), "2");
          await redis.set(
            attemptKey(name, groupId),
            String(JOB_RETRY_CONFIG.maxAttempts),
          );
          await queue.send({
            id: "event_streak",
            groupId,
            value: "x",
            __jobType: "subscriber",
            __jobName: "pm:langyConversation",
          });

          await vi.waitFor(
            async () => {
              expect(await blockedMembers(name)).toContain(groupId);
            },
            { timeout: 20000, interval: 50 },
          );
          expect(await failStreak(name, groupId)).toBe("3");

          const ops = new QueueRedisRepository(redis);
          await ops.unblockGroup({ queueName: name, groupId });
          expect(await failStreak(name, groupId)).toBeNull();

          await vi.waitFor(() => expect(seen).toHaveLength(2), {
            timeout: 20000,
            interval: 25,
          });
          // Pre-ADR-080 the streak survived at 3, so this single failure took
          // it to 4 — past the threshold — and quarantined the group instantly.
          await vi.waitFor(
            async () => {
              expect(await failStreak(name, groupId)).toBe("1");
            },
            { timeout: 10000, interval: 25 },
          );
          expect(await blockedMembers(name)).not.toContain(groupId);
        }, 60000);
      });
    });

    describe("given two groups blocked after exhaustion", () => {
      describe("when one is unblocked immediately and the other much later", () => {
        /** @scenario An unblocked group's fresh ladder does not depend on how long the operator waited */
        it("gives both the same retry budget on their next run", async () => {
          const name = freshName();
          const promptGroup = `${TENANT}/unblocked-promptly`;
          const lateGroup = `${TENANT}/unblocked-later`;
          const seen: { groupId: string; attempt: number }[] = [];
          const queue = newQueue({
            name,
            processFn: async (payload, delivery) => {
              seen.push({
                groupId: payload.groupId,
                attempt: delivery?.attempt ?? 0,
              });
              throw new Error("downstream always down");
            },
            consumerEnabled: true,
            objectStore: new InMemoryObjectStore(),
          });
          await queue.waitUntilReady();

          for (const groupId of [promptGroup, lateGroup]) {
            await redis.set(
              attemptKey(name, groupId),
              String(JOB_RETRY_CONFIG.maxAttempts),
            );
            await queue.send({
              id: `event_${groupId}`,
              groupId,
              value: "x",
              __jobType: "subscriber",
              __jobName: "pm:langyConversation",
            });
          }

          await vi.waitFor(
            async () => {
              const blocked = await blockedMembers(name);
              expect(blocked).toContain(promptGroup);
              expect(blocked).toContain(lateGroup);
            },
            { timeout: 25000, interval: 50 },
          );

          // The only difference between the two is how long the operator took:
          // the retry chain self-expires, so a button pressed after its TTL
          // finds nothing left to inherit.
          expect(await groupAttempt(name, promptGroup)).toBe(
            String(JOB_RETRY_CONFIG.maxAttempts),
          );
          await redis.del(attemptKey(name, lateGroup));

          const ops = new QueueRedisRepository(redis);
          await ops.unblockGroup({ queueName: name, groupId: promptGroup });
          await ops.unblockGroup({ queueName: name, groupId: lateGroup });

          await vi.waitFor(
            () => {
              expect(
                seen.filter((s) => s.groupId === promptGroup),
              ).toHaveLength(2);
              expect(seen.filter((s) => s.groupId === lateGroup)).toHaveLength(
                2,
              );
            },
            { timeout: 25000, interval: 25 },
          );

          // Pre-ADR-080 the promptly-unblocked group came back on attempt 25
          // and the patient operator's group came back on attempt 1.
          expect(
            seen.filter((s) => s.groupId === promptGroup)[1]!.attempt,
          ).toBe(1);
          expect(seen.filter((s) => s.groupId === lateGroup)[1]!.attempt).toBe(
            1,
          );
        }, 90000);
      });
    });

    // ======================================================================
    // Rule: The ladder for a body that cannot be read is bounded by what it
    //       can read
    // ======================================================================

    describe("given a staged job whose body cannot be fetched", () => {
      /** Claims the crafted job and waits for the ladder to write the chain. */
      async function runLadderOnce({
        name,
        groupId,
        objectStore,
        expectChain,
      }: {
        name: string;
        groupId: string;
        objectStore: InMemoryObjectStore;
        expectChain: string;
      }): Promise<void> {
        const queue = newQueue({
          name,
          processFn: async () => {},
          consumerEnabled: true,
          objectStore,
        });
        await queue.waitUntilReady();
        await vi.waitUntil(
          async () => (await groupAttempt(name, groupId)) === expectChain,
          { timeout: 20000, interval: 25 },
        );
      }

      describe("when the message says which attempt it is on", () => {
        /** @scenario The unreadable-body ladder counts the attempt the message carries */
        it("treats it as the next attempt after the one on the message", async () => {
          const name = freshName();
          const groupId = `${TENANT}/ladder-from-message`;
          const objectStore = new UnreachableObjectStore();
          const stagedJobId = "event_msg/subscriber/pm:langyConversation";
          await stageOffloadedUnder({
            name,
            groupId,
            stagedJobId,
            objectStore,
            attempt: 5,
          });

          await runLadderOnce({ name, groupId, objectStore, expectChain: "6" });

          // Pre-ADR-080 this ladder could only count `/r/` segments on the id,
          // so a message that already said "attempt 5" was read as a fresh one.
          expect(
            readJobAttempt((await stagedValue(name, groupId, stagedJobId))!),
          ).toBe(6);
          expect(await stagedIds(name, groupId)).toEqual([stagedJobId]);
        }, 45000);
      });

      describe("when the message cannot report an attempt", () => {
        /** @scenario The unreadable-body ladder falls back to the group's retry chain when the message cannot say */
        it("counts the attempt from the group's retry chain instead", async () => {
          const name = freshName();
          const groupId = `${TENANT}/ladder-from-chain`;
          const objectStore = new UnreachableObjectStore();
          const stagedJobId = "event_chain/subscriber/pm:langyConversation";
          // Staged with no attempt on its message at all — `readJobAttempt`
          // reports null, which the ladder reads as "this message cannot say".
          await stageOffloadedUnder({
            name,
            groupId,
            stagedJobId,
            objectStore,
          });
          expect(
            readJobAttempt((await stagedValue(name, groupId, stagedJobId))!),
          ).toBeNull();
          // A group that has already been round the ladder several times.
          await redis.set(attemptKey(name, groupId), "9");

          await runLadderOnce({
            name,
            groupId,
            objectStore,
            expectChain: "10",
          });

          expect(await stagedIds(name, groupId)).toEqual([stagedJobId]);
        }, 45000);
      });

      describe("when the message and the group disagree about the attempt", () => {
        /** @scenario The unreadable-body ladder takes the higher of the message and the group's chain */
        it("counts from whichever of the two is further along", async () => {
          const name = freshName();
          const objectStore = new UnreachableObjectStore();
          const chainAhead = `${TENANT}/ladder-chain-ahead`;
          const messageAhead = `${TENANT}/ladder-message-ahead`;

          await stageOffloadedUnder({
            name,
            groupId: chainAhead,
            stagedJobId: "event_a/subscriber/pm:langyConversation",
            objectStore,
            attempt: 3,
          });
          await redis.set(attemptKey(name, chainAhead), "9");

          await stageOffloadedUnder({
            name,
            groupId: messageAhead,
            stagedJobId: "event_b/subscriber/pm:langyConversation",
            objectStore,
            attempt: 9,
          });
          await redis.set(attemptKey(name, messageAhead), "3");

          const queue = newQueue({
            name,
            processFn: async () => {},
            consumerEnabled: true,
            objectStore,
          });
          await queue.waitUntilReady();

          await vi.waitFor(
            async () => {
              expect(await groupAttempt(name, chainAhead)).toBe("10");
              expect(await groupAttempt(name, messageAhead)).toBe("10");
            },
            { timeout: 25000, interval: 25 },
          );
        }, 45000);
      });

      describe("when the ladder runs rung after rung", () => {
        /** @scenario Every rung of the unreadable-body ladder advances the count the next rung reads */
        /** @scenario The unreadable-body ladder records each attempt on the group's retry chain */
        it("counts each attempt higher than the last and records every one on the group's chain", async () => {
          const name = freshName();
          const groupId = `${TENANT}/ladder-rungs`;
          const objectStore = new UnreachableObjectStore();
          const stagedJobId = "event_rungs/subscriber/pm:langyConversation";

          // Every re-stage the ladder issues, with the attempt its message
          // carries and the attempt its group chain held at that moment.
          const rungs: { onMessage: number | null; onChain: string | null }[] =
            [];
          const realRestage = GroupStagingScripts.prototype.retryRestage;
          vi.spyOn(
            GroupStagingScripts.prototype,
            "retryRestage",
          ).mockImplementation(async function (
            this: GroupStagingScripts,
            args: Parameters<typeof realRestage>[0],
          ) {
            rungs.push({
              onMessage: readJobAttempt(args.jobDataJson),
              onChain: await groupAttempt(name, args.groupId),
            });
            return realRestage.call(this, args);
          });

          await stageOffloadedUnder({
            name,
            groupId,
            stagedJobId,
            objectStore,
          });
          const queue = newQueue({
            name,
            processFn: async () => {},
            consumerEnabled: true,
            objectStore,
          });
          await queue.waitUntilReady();

          await vi.waitFor(() => expect(rungs).toHaveLength(3), {
            timeout: 40000,
            interval: 25,
          });

          // Pre-ADR-080 nothing on the message or the chain moved at all: the
          // count lived only in a segment appended to the id.
          expect(rungs.map((r) => r.onMessage)).toEqual([1, 2, 3]);
          // The chain is written INSIDE retryRestage, and this samples on the
          // way in — so each rung sees what the PREVIOUS one recorded, and the
          // first sees nothing because no re-stage has happened yet. That lag
          // is the property: the chain only ever advances together with a
          // re-stage that actually landed. It used to be written by the caller
          // beforehand, which is how a failed write could leave a re-staged
          // job with no record of its attempt anywhere.
          expect(rungs.map((r) => r.onChain)).toEqual([null, "1", "2"]);
          // And the last rung's write did land, so nothing is lost by the lag.
          expect(await groupAttempt(name, groupId)).toBe("3");
          expect(await stagedIds(name, groupId)).toEqual([stagedJobId]);
        }, 60000);
      });
    });

    describe("given a job in a format whose message cannot carry an attempt", () => {
      describe("when the ladder runs with the body unreachable", () => {
        /** @scenario A job whose attempt can never be written to its message still gives up at the end of the budget */
        it("gives up once the budget is spent rather than retrying forever", async () => {
          const name = freshName();
          const groupId = `${TENANT}/uncarryable-attempt`;
          const objectStore = new UnreachableObjectStore();

          // The dispatched job is legacy bare JSON: `withJobAttempt` cannot
          // write an attempt into it and `readJobAttempt` finds none. It is a
          // coalesced sibling whose body is unreachable that routes THIS value
          // through the unreadable-body ladder, so the chain is the only thing
          // that can ever bound it.
          const routing = {
            __pipelineName: "billing",
            __jobType: "fold",
            __jobName: "governanceOcsfEventsSync",
          };
          const dispatchedId = "event_bare/fold/governanceOcsfEventsSync";
          const bareJson = JSON.stringify({
            id: dispatchedId,
            groupId,
            value: "small-and-readable",
            ...routing,
          });
          expect(readJobAttempt(bareJson)).toBeNull();
          expect(withJobAttempt({ value: bareJson, attempt: 9 })).toBe(
            bareJson,
          );

          const scripts = new GroupStagingScripts(redis, name);
          await scripts.stageBatch([
            {
              stagedJobId: dispatchedId,
              groupId,
              dispatchAfterMs: Date.now() - 1000,
              dedupId: "",
              dedupTtlMs: 0,
              jobDataJson: bareJson,
            },
          ]);
          await stageOffloadedUnder({
            name,
            groupId,
            stagedJobId: "event_sibling/fold/governanceOcsfEventsSync",
            objectStore,
            routing,
          });

          // The chain is one rung from the end of the budget.
          await redis.set(
            attemptKey(name, groupId),
            String(JOB_RETRY_CONFIG.maxAttempts - 1),
          );

          const queue = newQueue({
            name,
            processFn: async () => {},
            processBatch: async () => {},
            coalesceMaxBatch: () => 50,
            consumerEnabled: true,
            objectStore,
          });
          await queue.waitUntilReady();

          await vi.waitFor(
            async () => {
              const drops = await dropsFor(name);
              expect(
                drops.filter((d) => d.labels.reason === "transient_exhausted"),
              ).not.toHaveLength(0);
            },
            { timeout: 25000, interval: 50 },
          );

          // It gave up on this job instead of re-staging it for another rung:
          // without the chain write, a message that can never carry a count
          // would have made the ladder unbounded.
          expect(await stagedIds(name, groupId)).not.toContain(dispatchedId);
        }, 45000);
      });
    });

    // ======================================================================
    // Rule: Jobs already staged under the old growing ids finish under them
    // ======================================================================

    describe("given a job staged before this change, whose id carries retry segments", () => {
      const LEGACY_ID =
        "event_legacy/subscriber/pm:langyConversation/r/12/r/16/r/24";

      describe("when a worker claims and processes it", () => {
        /** @scenario A job staged under a legacy retry-suffixed id still completes */
        it("completes normally and leaves staging", async () => {
          const name = freshName();
          const groupId = `${TENANT}/legacy-completes`;
          const processed: TestPayload[] = [];
          const scripts = new GroupStagingScripts(redis, name);
          await scripts.stageBatch([
            {
              stagedJobId: LEGACY_ID,
              groupId,
              dispatchAfterMs: Date.now(),
              dedupId: "",
              dedupTtlMs: 0,
              jobDataJson: JSON.stringify({
                id: "event_legacy",
                groupId,
                value: "x",
                __jobType: "subscriber",
                __jobName: "pm:langyConversation",
              }),
            },
          ]);

          const queue = newQueue({
            name,
            processFn: async (p) => {
              processed.push(p);
            },
            consumerEnabled: true,
            objectStore: new InMemoryObjectStore(),
          });
          await queue.waitUntilReady();

          await vi.waitFor(() => expect(processed).toHaveLength(1), {
            timeout: 20000,
            interval: 25,
          });
          expect(processed[0]!.value).toBe("x");
          await vi.waitFor(
            async () => {
              expect(await stagedIds(name, groupId)).toEqual([]);
              expect(await redis.hgetall(dataKey(name, groupId))).toEqual({});
            },
            { timeout: 10000, interval: 25 },
          );
        }, 45000);
      });

      describe("when it is retried, exhausts its budget, and its group is parked", () => {
        /** @scenario A legacy retry-suffixed id gains no further segments */
        it("keeps exactly the id it was dispatched under at every step", async () => {
          const name = freshName();
          const groupId = `${TENANT}/legacy-no-growth`;
          const scripts = new GroupStagingScripts(redis, name);
          await scripts.stageBatch([
            {
              stagedJobId: LEGACY_ID,
              groupId,
              dispatchAfterMs: Date.now(),
              dedupId: "",
              dedupTtlMs: 0,
              jobDataJson: JSON.stringify({
                id: "event_legacy",
                groupId,
                value: "x",
                __jobType: "subscriber",
                __jobName: "pm:langyConversation",
              }),
            },
          ]);

          let failures = 0;
          const consumer = newQueue({
            name,
            processFn: async () => {
              failures++;
              throw new Error("downstream always down");
            },
            consumerEnabled: true,
            objectStore: new InMemoryObjectStore(),
          });
          await consumer.waitUntilReady();

          // Step 1 — a retry.
          await vi.waitFor(
            async () => {
              expect(failures).toBeGreaterThan(0);
              expect(await groupAttempt(name, groupId)).toBe("2");
            },
            { timeout: 20000, interval: 25 },
          );
          expect(await stagedIds(name, groupId)).toEqual([LEGACY_ID]);

          // Step 2 — the end of the budget.
          await redis.set(
            attemptKey(name, groupId),
            String(JOB_RETRY_CONFIG.maxAttempts),
          );
          await vi.waitFor(
            async () => {
              expect(await blockedMembers(name)).toContain(groupId);
            },
            { timeout: 25000, interval: 50 },
          );
          expect(await stagedIds(name, groupId)).toEqual([LEGACY_ID]);

          // Step 3 — a poison park. Stop the consumer first so the strikes are
          // in place before any claim can race them.
          await consumer.close();
          const ops = new QueueRedisRepository(redis);
          await ops.unblockGroup({ queueName: name, groupId });
          await redis.set(
            strikesKey(name, groupId),
            String(DEFAULT_CLAIM_STRIKE_THRESHOLD),
          );

          const parker = newQueue({
            name,
            processFn: async () => {},
            consumerEnabled: true,
            objectStore: new InMemoryObjectStore(),
          });
          await parker.waitUntilReady();
          await vi.waitFor(
            async () => {
              expect(await blockedMembers(name)).toContain(groupId);
            },
            { timeout: 20000, interval: 50 },
          );
          // Pre-ADR-080 each of these three steps appended another segment:
          // `/r/1`, then `/r/<Date.now()>`, then `/p/<Date.now()>`.
          expect(await stagedIds(name, groupId)).toEqual([LEGACY_ID]);
        }, 90000);
      });
    });

    describe("given a job staged before this change, part-way through its retry budget", () => {
      describe("when it fails again after this change is deployed", () => {
        /** @scenario A job staged under a legacy retry-suffixed id resumes its ladder rather than restarting it */
        it("retries on the attempt after the one its id had reached", async () => {
          const name = freshName();
          const groupId = `${TENANT}/legacy-resumes`;
          const objectStore = new UnreachableObjectStore();
          const legacyId = "event_resume/subscriber/pm:langyConversation/r/7";

          // Neither its message nor its group can say how far it got: the
          // count was recorded ONLY in the id, which is exactly the in-flight
          // job this last-resort read exists for.
          await stageOffloadedUnder({
            name,
            groupId,
            stagedJobId: legacyId,
            objectStore,
          });
          expect(
            readJobAttempt((await stagedValue(name, groupId, legacyId))!),
          ).toBeNull();
          expect(await groupAttempt(name, groupId)).toBeNull();

          const queue = newQueue({
            name,
            processFn: async () => {},
            consumerEnabled: true,
            objectStore,
          });
          await queue.waitUntilReady();

          await vi.waitFor(
            async () => {
              expect(await groupAttempt(name, groupId)).toBe("8");
            },
            { timeout: 25000, interval: 25 },
          );
          // Resumed, not restarted — a fresh budget would have read attempt 1.
          expect(
            readJobAttempt((await stagedValue(name, groupId, legacyId))!),
          ).toBe(8);
          expect(await stagedIds(name, groupId)).toEqual([legacyId]);
        }, 45000);
      });
    });
  },
);
