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

import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import {
  getTestRedisConnection,
  startTestContainers,
  stopTestContainers,
} from "../../../__tests__/integration/testContainers";
import type { EventSourcedQueueDefinition } from "../../queue.types";
import { GroupQueueProcessor } from "../groupQueue";
import { gqJobsDroppedTotal, gqJobsRetriedTotal } from "../metrics";
import { incompressible, InMemoryObjectStore } from "./blobTestDoubles";

// Skip outside testcontainers (e.g. plain unit runs) — mirrors the other
// groupQueue integration suites (groupQueue.decodeDrop/gq2).
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
  // Caller-controlled routing fields (allowed through the __* guard — see
  // groupQueue.gq2.integration.test.ts). Optional so plain sends still work.
  __pipelineName?: string;
  __jobType?: string;
  __jobName?: string;
};

// Tenant prefix for groupIds so GQ2 (content-addressed, tenant-namespaced)
// offload activates — see jobEnvelope.ts's projectIdFor / tenantIdFromGroupId.
const TENANT = createTenantId("proj1");
const STORAGE_DESTINATION = async () =>
  ({ kind: "s3" as const, bucket: "test-bucket" });

// > the 256 KiB s3 threshold once gzipped (see groupQueue.gq2.integration.test.ts).
// Each sibling gets its own blob so a single one can be corrupted in isolation.
const OFFLOADABLE_S3_VALUE = () => incompressible(768 * 1024);

describe.skipIf(!hasTestcontainers)(
  "GroupQueueProcessor — restageDrainedSiblings skips already-dropped siblings (#5857)",
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
      // Scoped to this suite's hash-tagged namespace — never a global
      // flushall, which would race with parallel integration suites on the
      // shared Redis (see groupQueue.gq2.integration.test.ts).
      const keys = await redis.keys("{test/gqrestage/*");
      if (keys.length > 0) await redis.del(...keys);
      vi.unstubAllEnvs();
    });

    afterAll(async () => {
      await stopTestContainers();
    });

    function freshName(): string {
      return `{test/gqrestage/${crypto.randomUUID().slice(0, 8)}}`;
    }

    function newQueue({
      name,
      processFn,
      processBatch,
      consumerEnabled,
      objectStore,
    }: {
      name: string;
      processFn: (payload: TestPayload) => Promise<void>;
      processBatch?: (payloads: TestPayload[]) => Promise<void>;
      consumerEnabled: boolean;
      objectStore: InMemoryObjectStore;
    }): GroupQueueProcessor<TestPayload> {
      const definition: EventSourcedQueueDefinition<TestPayload> = {
        name,
        groupKey: (p) => p.groupId,
        process: processFn,
        processBatch,
        // coalesceMaxBatch only kicks in when processBatch is defined (the
        // drain block guards on `maxBatch > 1 && this.processBatch`), so
        // setting it unconditionally is harmless for the staging queue.
        coalesceMaxBatch: () => 50,
      };
      const queue = new GroupQueueProcessor<TestPayload>(definition, redis, {
        consumerEnabled,
        objectStoreFor: () => objectStore,
        resolveStorageDestination: STORAGE_DESTINATION,
      });
      queues.push(queue);
      return queue;
    }

    /** All `gq_jobs_dropped_total` samples recorded for this test's queue. */
    async function dropsFor(name: string) {
      const metric = await gqJobsDroppedTotal.get();
      return metric.values.filter((v) => v.labels.queue_name === name);
    }

    /**
     * Sum of `gq_jobs_dropped_total` for `reason: "body_unreadable"` — the
     * reason parseDrainedPayload records when a sibling's blob is corrupt.
     *
     * With the fix: the corrupted sibling B is dropped exactly once (by
     * parseDrainedPayload on the first drain), then skipped by
     * restageDrainedSiblings on every subsequent retry, so the counter stays
     * at exactly 1.
     *
     * Without the fix: B is re-staged on every retry cycle, re-dispatched
     * on the next drain, and re-dropped — the counter climbs by 1 per
     * retry. With a retryable handler error and a 4s wait window, the
     * exponential backoff (500ms, 1s, 2s, 4s) lets ~3-4 retry cycles
     * surface, so the counter climbs to 2-4.
     */
    async function bodyUnreadableDropCount(name: string): Promise<number> {
      const drops = await dropsFor(name);
      return drops
        .filter((d) => d.labels.reason === "body_unreadable")
        .reduce((sum, d) => sum + d.value, 0);
    }

    /** Sum of `gq_jobs_retried_total` for this queue — guards the test
     * against an inverted predicate (`if (!sibling.dropped) continue;`)
     * that would skip ALL siblings: with such a regression, the dispatched
     * job A still retries but C is never re-staged, so retriedTotal stays
     * bounded while healthy re-dispatch is silently broken. We assert it
     * increments at least once to confirm the retry path actually ran. */
    async function retriedCount(name: string): Promise<number> {
      const metric = await gqJobsRetriedTotal.get();
      return metric.values
        .filter((v) => v.labels.queue_name === name)
        .reduce((sum, v) => sum + v.value, 0);
    }

    /**
     * Stages multiple offloaded jobs in a group via a staging queue
     * (consumerEnabled:false so corruption races no consumer). Each payload
     * exceeds the 256 KiB S3 threshold, so each gets its own blob in
     * objectStore.store (Map insertion order = staging order).
     */
    async function stageOffloadedBatch({
      name,
      groupId,
      objectStore,
      jobs,
    }: {
      name: string;
      groupId: string;
      objectStore: InMemoryObjectStore;
      jobs: Array<{ id: string; value: string }>;
    }): Promise<void> {
      const staging = newQueue({
        name,
        processFn: async () => {},
        consumerEnabled: false,
        objectStore,
      });
      await staging.waitUntilReady();
      for (const job of jobs) {
        await staging.send({
          id: job.id,
          groupId,
          value: job.value,
        });
      }
    }

    describe("given a coalesced batch where one sibling fails to decode before processBatch throws", () => {
      describe("when the worker catches the processBatch failure and re-stages siblings", () => {
        /**
         * @scenario restageDrainedSiblings skips a sibling already dropped via
         * parseDrainedPayload, so the dropped job is not resurrected into the
         * ready queue (#5857). Without the fix, the dropped sibling is
         * re-staged, re-dispatched, and re-dropped on the next drain — a
         * resurrection loop that increments gq_jobs_dropped_total repeatedly
         * for the same logical job.
         *
         * The handler throws a plain Error (retryable) rather than a
         * ValidationError (non-retryable) so the dispatched job A drives the
         * retry path — not handleExhaustedRetries→restageAndBlock. A
         * non-retryable error blocks the group on the first failure, so B
         * never gets re-dispatched and the counter stays at 1 even on the
         * buggy code (false green). A retryable error keeps the group
         * unblocked: each retry re-drains whatever is in the ready zset —
         * with the bug B is in the zset (re-staged), so it is re-drained and
         * re-dropped; with the fix B was skipped, so only A and C retry.
         */
        it("does not re-stage the already-dropped sibling", async () => {
          const name = freshName();
          const groupId = `${TENANT}/restage-skip`;
          const objectStore = new InMemoryObjectStore();

          // Stage three jobs in the same group: A (dispatched, lowest score),
          // B (will be corrupted → dropped by parseDrainedPayload), C (healthy
          // sibling, highest score). Staging is sequential so each send
          // produces a strictly-later dispatch score, which makes A the
          // dispatched job and B/C the drained siblings on the first claim.
          await stageOffloadedBatch({
            name,
            groupId,
            objectStore,
            jobs: [
              { id: "A", value: OFFLOADABLE_S3_VALUE() },
              { id: "B", value: OFFLOADABLE_S3_VALUE() },
              { id: "C", value: OFFLOADABLE_S3_VALUE() },
            ],
          });

          // Corrupt B's blob (the SECOND uri in insertion order). The body
          // is present but unreadable, so parseDrainedPayload routes it to
          // recordDrop with reason "body_unreadable" — NOT TransientBlobStoreError
          // (which would re-throw and take the restage-all path at line 895)
          // and NOT PayloadTooLargeError (which would re-throw and park the
          // group at line 913). This is the only drop path that leaves the
          // sibling in the drainedSiblings array after the batch parse.
          const uris = [...objectStore.store.keys()];
          expect(uris.length).toBe(3);
          const bUri = uris[1]!;
          objectStore.store.set(bUri, Buffer.from("not a valid gzip body"));

          // processBatch throws a *retryable* plain Error so the dispatched
          // job A drives the retry path (retryRestage + backoff) rather than
          // handleExhaustedRetries→restageAndBlock. The group stays
          // unblocked, so each retry re-dispatches A and re-drains whatever
          // is in the ready zset. restageDrainedSiblings still runs on
          // every catch (the [B, C] sibling batch) — that is the call site
          // under test (groupQueue.ts line ~1078).
          const consumer = newQueue({
            name,
            processFn: async () => {},
            processBatch: async () => {
              throw new Error("handler blew up");
            },
            consumerEnabled: true,
            objectStore,
          });
          await consumer.waitUntilReady();

          // Wait for B's first drop (parseDrainedPayload fails → recordDrop
          // with reason "body_unreadable"). This is the only drop the fix
          // permits; every subsequent drop would be a resurrection.
          await vi.waitFor(
            async () => {
              expect(await bodyUnreadableDropCount(name)).toBeGreaterThanOrEqual(1);
            },
            { timeout: 15000, interval: 100 },
          );

          // Wait long enough for the retry loop to surface any resurrection.
          // Backoff schedule (shared.ts): 500ms → 1s → 2s → 4s. A 4s wait
          // covers ~3 retry cycles beyond the initial drop. With the bug,
          // each cycle re-drains B and re-drops it (counter climbs to 2-4).
          // With the fix, B was skipped by restageDrainedSiblings, so it is
          // never re-staged, never re-drained, never re-dropped (counter = 1).
          await new Promise((resolve) => setTimeout(resolve, 4000));

          // The fix's invariant: B was dropped exactly once. With the bug,
          // the counter climbs past 1 within the 4s window.
          expect(await bodyUnreadableDropCount(name)).toBe(1);

          // Positive-direction guard: the retry path actually ran (so the
          // test exercised the catch block at line ~1078, not the
          // exhausted/dead-letter branch). Without this assertion, an
          // inverted predicate (`if (!sibling.dropped) continue;`) that
          // skips ALL siblings — including healthy C — would still pass the
          // drop-count assertion above while silently breaking healthy
          // re-dispatch. A non-zero retry count proves the dispatched job A
          // cycled through retryRestage, which only happens when the catch
          // block executed the restageDrainedSiblings call under test.
          expect(await retriedCount(name)).toBeGreaterThan(0);
        });
      });
    });
  },
);
