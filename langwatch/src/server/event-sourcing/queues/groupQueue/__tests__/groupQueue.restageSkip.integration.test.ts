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
import {
  incompressible,
  InMemoryObjectStore,
  PerUriTransientFailureStore,
} from "./blobTestDoubles";

// Skip outside testcontainers (e.g. plain unit runs) -- mirrors the other
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
  // Caller-controlled routing fields (allowed through the __* guard -- see
  // groupQueue.gq2.integration.test.ts). Optional so plain sends still work.
  __pipelineName?: string;
  __jobType?: string;
  __jobName?: string;
};

// Tenant prefix for groupIds so GQ2 (content-addressed, tenant-namespaced)
// offload activates -- see jobEnvelope.ts's projectIdFor / tenantIdFromGroupId.
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
      // Scoped to this suite's hash-tagged namespace -- never a global
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
     * Sum of `gq_jobs_dropped_total` for `reason: "body_unreadable"` -- the
     * reason parseDrainedPayload records when a sibling's blob is corrupt.
     *
     * With the fix: the corrupted sibling B is dropped exactly once (by
     * parseDrainedPayload on the first drain), then skipped by
     * restageDrainedSiblings on every subsequent retry, so the counter stays
     * at exactly 1.
     *
     * Without the fix: B is re-staged on every retry cycle, re-dispatched
     * on the next drain, and re-dropped -- the counter climbs by 1 per
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

    /** Sum of `gq_jobs_retried_total` for this queue -- guards the test
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
         * re-staged, re-dispatched, and re-dropped on the next drain -- a
         * resurrection loop that increments gq_jobs_dropped_total repeatedly
         * for the same logical job.
         *
         * The handler throws a plain Error (retryable) rather than a
         * ValidationError (non-retryable) so the dispatched job A drives the
         * retry path -- not handleExhaustedRetries->restageAndBlock. A
         * non-retryable error blocks the group on the first failure, so B
         * never gets re-dispatched and the counter stays at 1 even on the
         * buggy code (false green). A retryable error keeps the group
         * unblocked: each retry re-drains whatever is in the ready zset --
         * with the bug B is in the zset (re-staged), so it is re-drained and
         * re-dropped; with the fix B was skipped, so only A and C retry.
         */
        it("does not re-stage the already-dropped sibling", async () => {
          const name = freshName();
          const groupId = `${TENANT}/restage-skip`;
          const objectStore = new InMemoryObjectStore();

          // Stage three jobs in the same group: A (dispatched, lowest score),
          // B (will be corrupted -> dropped by parseDrainedPayload), C (healthy
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
          // recordDrop with reason "body_unreadable" -- NOT TransientBlobStoreError
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
          // handleExhaustedRetries->restageAndBlock. The group stays
          // unblocked, so each retry re-dispatches A and re-drains whatever
          // is in the ready zset. restageDrainedSiblings still runs on
          // every catch (the [B, C] sibling batch) -- that is the call site
          // under test (groupQueue.ts line ~1078).
          //
          // seenPayloads records every payload observed by either handler
          // across both processing paths. Used below to assert healthy
          // sibling C is re-dispatched at least once after the initial
          // batch -- guarding against an inverted predicate that skips
          // ALL siblings (e.g. an unconditional `continue;`), which would
          // leave A retrying alone (so retriedCount > 0 still passes)
          // while C is silently lost.
          const seenPayloads: TestPayload[] = [];
          const consumer = newQueue({
            name,
            processFn: async (payload) => {
              seenPayloads.push(payload);
            },
            processBatch: async (payloads) => {
              seenPayloads.push(...payloads);
              throw new Error("handler blew up");
            },
            consumerEnabled: true,
            objectStore,
          });
          await consumer.waitUntilReady();

          // Wait for B's first drop (parseDrainedPayload fails -> recordDrop
          // with reason "body_unreadable"). This is the only drop the fix
          // permits; every subsequent drop would be a resurrection.
          await vi.waitFor(
            async () => {
              expect(await bodyUnreadableDropCount(name)).toBeGreaterThanOrEqual(1);
            },
            { timeout: 15000, interval: 100 },
          );

          // Wait long enough for the retry loop to surface any resurrection.
          // Backoff schedule (shared.ts): 500ms -> 1s -> 2s -> 4s. A 4s wait
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
          // skips ALL siblings -- including healthy C -- would still pass the
          // drop-count assertion above while silently breaking healthy
          // re-dispatch. A non-zero retry count proves the dispatched job A
          // cycled through retryRestage, which only happens when the catch
          // block executed the restageDrainedSiblings call under test.
          expect(await retriedCount(name)).toBeGreaterThan(0);

          // Functional correctness guard: healthy sibling C must be
          // observed by the handler at least twice -- once in the initial
          // batch (A,C), and at least once more in a retry batch (A,C) --
          // proving restageDrainedSiblings actually re-staged C. The
          // retriedCount assertion above only proves A cycled through
          // retryRestage; an unconditional `continue;` (or any predicate
          // that skips every sibling) would leave A retrying alone with
          // retriedCount > 0 still true but C silently lost. This
          // assertion closes that gap by directly observing C's
          // re-dispatch across both processing paths.
          const cAppearances = seenPayloads.filter((p) => p.id === "C").length;
          expect(cAppearances).toBeGreaterThanOrEqual(2);
        });

        /**
         * @scenario restageDrainedSiblings must await every parse result
         * before re-throwing a transient sibling rejection, so a sibling
         * whose body is genuinely corrupt gets its `recordDrop` marker
         * recorded before the transient sibling's rejection short-circuits
         * the parse (#5883 P1). Without `Promise.allSettled`, the transient
         * rejection races ahead of the corrupt sibling's drop marker:
         * `restageDrainedSiblings` then sees the corrupt sibling as
         * still-pending, re-stages it, and the next drain re-dispatches and
         * re-drops it -- a resurrection loop identical to the one above,
         * but triggered by a *different* sibling's failure.
         *
         * Setup: A (dispatched, healthy), B (transient failure on first
         * drain only -- `failureCounts.set(bUri, 1)`), C (corrupt -> dropped
         * by parseDrainedPayload on first drain). The handler throws a
         * plain retryable Error so the dispatched job A drives the retry
         * path (not handleExhaustedRetries->restageAndBlock).
         *
         * With the fix: the first drain settles all three parses. C's drop
         * is recorded before B's TransientBlobStoreError is re-thrown, so
         * restageDrainedSiblings skips C on every subsequent retry. B's
         * transient failure resolves on retry (failureCounts now 0), so B
         * is re-staged, re-parsed, and reaches processBatch.
         *
         * Without the fix: Promise.all short-circuits on B's transient
         * rejection before C's recordDrop runs. restageDrainedSiblings
         * sees no dropped marker for C, re-stages it, the next drain
         * re-dispatches and re-drops C -- the body_unreadable counter
         * climbs past 1 within the 4s retry window.
         */
        it("marks the corrupt sibling as dropped before re-throwing a transient sibling rejection", async () => {
          const name = freshName();
          const groupId = `${TENANT}/restage-skip-mixed`;
          const objectStore = new PerUriTransientFailureStore();

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

          const uris = [...objectStore.store.keys()];
          expect(uris.length).toBe(3);
          // uris[0] = A (dispatched, healthy -- no injection needed);
          // uris[1] = B (transient failure x1); uris[2] = C (corrupt -> drop).
          const bUri = uris[1]!;
          const cUri = uris[2]!;

          // B fails transiently exactly once on the first drain.
          // `tieredBlobStore` wraps the non-missing error as
          // `TransientBlobStoreError`, which `parseDrainedPayload` re-throws
          // (taking the restage-all path) -- distinct from C's corrupt-body
          // error, which routes to `recordDrop("body_unreadable")`. On
          // retry, `failureCounts[bUri]` is 0 so B parses normally.
          objectStore.failureCounts.set(bUri, 1);

          // C's body is present but unreadable -- same drop path the existing
          // test exercises. The race we're guarding against: if B's
          // transient rejection short-circuits Promise.all before C's
          // `recordDrop` runs, restageDrainedSiblings won't see C's dropped
          // marker and will re-stage C, leading to a re-dispatch and
          // re-drop on the next drain.
          objectStore.store.set(cUri, Buffer.from("not a valid gzip body"));

          // seenPayloads records every payload that reached either handler
          // across all processing paths. Used below to assert B (transient)
          // is eventually parsed and reaches processBatch after its
          // transient failure resolves -- guarding against a regression that
          // drops B along with C (e.g. a too-aggressive catch that drops all
          // siblings on any error), which would silently lose the
          // recoverable sibling while still passing the drop-count assertion.
          const seenPayloads: TestPayload[] = [];
          const consumer = newQueue({
            name,
            processFn: async (payload) => {
              seenPayloads.push(payload);
            },
            processBatch: async (payloads) => {
              seenPayloads.push(...payloads);
              throw new Error("handler blew up");
            },
            consumerEnabled: true,
            objectStore,
          });
          await consumer.waitUntilReady();

          // Wait for C's first drop (corrupt -> body_unreadable). This is
          // the only drop the fix permits; every subsequent drop would be a
          // resurrection caused by B's transient rejection racing C's
          // recordDrop.
          await vi.waitFor(
            async () => {
              expect(await bodyUnreadableDropCount(name)).toBeGreaterThanOrEqual(1);
            },
            { timeout: 15000, interval: 100 },
          );

          // Wait long enough for the retry loop to surface any
          // resurrection. Backoff schedule (shared.ts): 500ms -> 1s -> 2s -> 4s.
          // A 4s wait covers ~3 retry cycles beyond the initial drop. With
          // the bug (Promise.all), each cycle re-drains C and re-drops it
          // (counter climbs to 2-4). With the fix (Promise.allSettled), C
          // was marked dropped before B's transient rejection was
          // re-thrown, so restageDrainedSiblings skips C on every retry
          // (counter = 1).
          await new Promise((resolve) => setTimeout(resolve, 4000));

          // The fix's invariant: C was dropped exactly once. With the bug,
          // the counter climbs past 1 within the 4s window.
          expect(await bodyUnreadableDropCount(name)).toBe(1);

          // Positive-direction guard: the retry path actually ran (so the
          // test exercised the catch block that calls restageDrainedSiblings,
          // not the exhausted/dead-letter branch). Without this assertion, a
          // regression that drops B along with C (and thus never retries)
          // would still pass the drop-count assertion.
          expect(await retriedCount(name)).toBeGreaterThan(0);

          // B's transient failure resolved on retry (failureCounts now 0),
          // so B must be observed by the handler at least once across all
          // retries -- proving the recoverable sibling was not permanently
          // lost. A regression that drops B along with C would leave B
          // absent from seenPayloads while still passing the drop-count
          // assertion above.
          const bAppearances = seenPayloads.filter((p) => p.id === "B").length;
          expect(bAppearances).toBeGreaterThanOrEqual(1);
        });
      });
    });
  },
);
