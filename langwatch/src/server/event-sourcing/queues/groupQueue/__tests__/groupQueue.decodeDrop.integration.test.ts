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
import { QueueRedisRepository } from "../../../../app-layer/ops/repositories/queue.redis.repository";
import {
  getTestRedisConnection,
  startTestContainers,
  stopTestContainers,
} from "../../../__tests__/integration/testContainers";
import type { EventSourcedQueueDefinition } from "../../queue.types";
import { GroupQueueProcessor } from "../groupQueue";
import { encodeJobEnvelope, readJobRecoveryKey } from "../jobEnvelope";
import { gqJobsDroppedTotal } from "../metrics";
import { GroupStagingScripts } from "../scripts";
import { TieredBlobStore } from "../tieredBlobStore";
import {
  FlakyObjectStore,
  incompressible,
  InMemoryJobBlobStore,
  InMemoryObjectStore,
} from "./blobTestDoubles";

// Skip outside testcontainers (e.g. plain unit runs) — mirrors the other
// groupQueue integration suites (groupQueue.poisonGuard/gq2).
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
  // #718: normally the QueueManager facade injects this; the harness sets it
  // directly (it is in CALLER_RESERVED_KEYS) to stand in for a reactor's event id.
  __recoveryKey?: string;
};

// Tenant prefix for groupIds so GQ2 (content-addressed, tenant-namespaced)
// offload activates — see jobEnvelope.ts's projectIdFor / tenantIdFromGroupId.
const TENANT = "proj1";
const PROJECT = createTenantId(TENANT);
const STORAGE_DESTINATION = async () =>
  ({ kind: "s3" as const, bucket: "test-bucket" });

// > the 256 KiB s3 threshold once gzipped (see groupQueue.gq2.integration.test.ts).
const OFFLOADABLE_S3_VALUE = () => incompressible(768 * 1024);

describe.skipIf(!hasTestcontainers)(
  "GroupQueueProcessor — decode-drop durability (#5538)",
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
      const keys = await redis.keys("{test/gqdrop/*");
      if (keys.length > 0) await redis.del(...keys);
      vi.unstubAllEnvs();
    });

    afterAll(async () => {
      await stopTestContainers();
    });

    function freshName(): string {
      return `{test/gqdrop/${crypto.randomUUID().slice(0, 8)}}`;
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
      processFn: (payload: TestPayload) => Promise<void>;
      consumerEnabled: boolean;
      objectStore: InMemoryObjectStore;
      // Opt-in batch coalescing (drives the drained-sibling path).
      processBatch?: (payloads: TestPayload[]) => Promise<void>;
      coalesceMaxBatch?: (payload: TestPayload) => number;
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

    const blockedMembers = (name: string) => redis.smembers(`${name}:gq:blocked`);
    const storedErrorMessage = (name: string, groupId: string) =>
      redis.hget(`${name}:gq:group:${groupId}:error`, "message");
    const completedStat = (name: string) => redis.get(`${name}:gq:stats:completed`);

    /** All `gq_jobs_dropped_total` samples recorded for this test's queue. */
    async function dropsFor(name: string) {
      const metric = await gqJobsDroppedTotal.get();
      return metric.values.filter((v) => v.labels.queue_name === name);
    }

    // Job-scoped dead-letter reads (#719). Same key layout the ops drain uses.
    const dlqValue = (name: string, groupId: string, stagedJobId: string) =>
      redis.hget(`${name}:gq:dlq:${groupId}:data`, stagedJobId);
    const dlqReason = (name: string, groupId: string, stagedJobId: string) =>
      redis.hget(`${name}:gq:dlq:${groupId}:error`, stagedJobId);
    const liveValue = (name: string, groupId: string, stagedJobId: string) =>
      redis.hget(`${name}:gq:group:${groupId}:data`, stagedJobId);

    /**
     * Stages a GQ2 s3-tier job directly (bypassing the dispatch loop) whose
     * stored bytes are then mutated by the caller before a consumer claims it
     * — so the corruption/deletion can never race the queue's own dispatcher.
     * `consumerEnabled:false` on the staging queue is what makes that safe
     * (same pattern as "given an offloaded job / when it is staged" in
     * groupQueue.gq2.integration.test.ts).
     */
    async function stageOffloaded({
      name,
      groupId,
      objectStore,
      extra,
    }: {
      name: string;
      groupId: string;
      objectStore: InMemoryObjectStore;
      extra?: Partial<TestPayload>;
    }): Promise<void> {
      const staging = newQueue({
        name,
        processFn: async () => {},
        consumerEnabled: false,
        objectStore,
      });
      await staging.waitUntilReady();
      await staging.send({
        id: "victim",
        groupId,
        value: OFFLOADABLE_S3_VALUE(),
        ...extra,
      });
    }

    /**
     * Serves and stores normally, but starts rejecting `put` after N writes — so
     * the initial stage succeeds and a LATER re-encode fails. That is the only
     * way to reach the retry-re-encode discard site.
     */
    class PutFailsAfterObjectStore extends InMemoryObjectStore {
      private putsLeft: number;
      constructor(putsBeforeFailing: number) {
        super();
        this.putsLeft = putsBeforeFailing;
      }
      override async put(uri: string, bytes: Buffer): Promise<void> {
        if (this.putsLeft <= 0) throw new Error("blob store unavailable on write");
        this.putsLeft--;
        return super.put(uri, bytes);
      }
    }

    describe("given a job whose retry cannot re-encode its payload", () => {
      describe("when the retry's re-encode fails", () => {
        it("counts the discard with the retry-encode-failed reason", async () => {
          // The 5th discard site, and the only one that had NO test and no
          // @unimplemented marker until a review counted them (#5538). It decodes
          // fine, then process() throws, then the retry's re-encode dies — so it
          // never reaches the decode drop branch the other tests exercise.
          const name = freshName();
          const groupId = `${TENANT}/retry-encode-fails`;
          const objectStore = new PutFailsAfterObjectStore(1); // stage ok, re-encode fails

          const consumer = newQueue({
            name,
            // A plain Error is retryable (isRetryableJobError → not CRITICAL), so
            // this drives the job into the retry path rather than the fail-safe.
            processFn: async () => {
              throw new Error("handler blew up");
            },
            consumerEnabled: true,
            objectStore,
          });
          await consumer.waitUntilReady();
          await consumer.send({
            id: "retry-victim",
            groupId,
            value: OFFLOADABLE_S3_VALUE(),
          });

          await vi.waitFor(
            async () => {
              expect(await dropsFor(name)).toHaveLength(1);
            },
            { timeout: 15000, interval: 100 },
          );

          const [entry] = await dropsFor(name);
          // Revert-check: before #5538 this site logged, INCR'd stats:completed as
          // a SUCCESS, and incremented only gqRetryEncodeFailuresTotal — nothing
          // named it a drop. Reverting removes gq_jobs_dropped_total entirely, so
          // dropsFor() stays empty and the waitFor above times out.
          expect(entry!.labels.reason).toBe("retry_encode_failed");
          // Unlike body-present decode failures, this path retires its lease:
          // the body was already read, so keeping the lease buys a later worker
          // nothing. Shared bytes remain for lazy lifecycle reclaim.
          expect(await redis.keys(`${name}:gq:blobleases:*`)).toHaveLength(0);
          expect(objectStore.deleted).toHaveLength(0);
          expect(objectStore.store.size).toBe(1);
          // AC8 still holds here: a discard is not a completion.
          expect(await completedStat(name)).toBeNull();
        });
      });
    });

    describe("given a staged job whose body is present but cannot be decoded", () => {
      describe("when a worker claims the group and the decode fails", () => {
        /** @scenario a body-present decode failure does not destroy the body it could not read */
        it("retires the lease without deleting the blob", async () => {
          const name = freshName();
          const groupId = `${TENANT}/body-present-release`;
          const objectStore = new InMemoryObjectStore();
          await stageOffloaded({ name, groupId, objectStore });

          // Body PRESENT, unreadable to this worker — the rolling-deploy
          // codec-skew shape (ADR-030), not an eviction. The key is left
          // present; only its bytes are replaced.
          expect(objectStore.store.size).toBe(1);
          for (const uri of [...objectStore.store.keys()]) {
            objectStore.store.set(uri, Buffer.from("not a valid gzip body"));
          }

          const processed = vi.fn<(p: TestPayload) => Promise<void>>();
          newQueue({
            name,
            processFn: processed,
            consumerEnabled: true,
            objectStore,
          });

          await vi.waitFor(
            async () => {
              expect(await dropsFor(name)).toHaveLength(1);
            },
            { timeout: 10000, interval: 100 },
          );

          expect(processed).not.toHaveBeenCalled();
          expect(await redis.keys(`${name}:gq:blobleases:*`)).toHaveLength(0);
          expect(objectStore.deleted).toEqual([]);
          expect(objectStore.store.size).toBe(1);
        });

        it("leaves the body readable from the blob store afterwards", async () => {
          const name = freshName();
          const groupId = `${TENANT}/body-present-readable`;
          const objectStore = new InMemoryObjectStore();
          await stageOffloaded({ name, groupId, objectStore });

          const [uri] = [...objectStore.store.keys()];
          const corrupted = Buffer.from("not a valid gzip body");
          objectStore.store.set(uri!, corrupted);

          newQueue({
            name,
            processFn: async () => {},
            consumerEnabled: true,
            objectStore,
          });

          await vi.waitFor(
            async () => {
              expect(await dropsFor(name)).toHaveLength(1);
            },
            { timeout: 10000, interval: 100 },
          );

          // Still there — a later worker that understood the codec could
          // still have read it. The exact bytes we left it with are exactly
          // what remains, proving nothing further touched the object.
          expect(objectStore.store.has(uri!)).toBe(true);
          expect(objectStore.store.get(uri!)).toEqual(corrupted);
        });
      });
    });

    describe("given a staged job whose referenced blob is genuinely gone", () => {
      describe("when a worker claims the group and the decode fails", () => {
        /** @scenario "a missing-blob drop releases the absent blob's holder" */
        it("releases the blob's lease without eager object deletion", async () => {
          const name = freshName();
          const groupId = `${TENANT}/missing-blob-release`;
          const objectStore = new InMemoryObjectStore();
          await stageOffloaded({ name, groupId, objectStore });

          const [uri] = [...objectStore.store.keys()];
          // Genuinely gone (TTL reclaim / manual purge), not corrupt: delete
          // the object outright rather than mutating its bytes.
          objectStore.store.delete(uri!);

          newQueue({
            name,
            processFn: async () => {},
            consumerEnabled: true,
            objectStore,
          });

          await vi.waitFor(
            async () => {
              expect(await dropsFor(name)).toHaveLength(1);
            },
            { timeout: 10000, interval: 100 },
          );

          // There is nothing left to preserve, so the lease is retired. The
          // application still never issues an eager shared-object delete.
          expect(await redis.keys(`${name}:gq:blobleases:*`)).toHaveLength(0);
          expect(objectStore.deleted).toHaveLength(0);
        });
      });
    });

    describe("given a drop with a full envelope header", () => {
      describe("when a worker claims the group and the decode fails", () => {
        /** @scenario a drop names which pipeline and job lost the event */
        it("counts the loss once with the queue, pipeline, job type, and job name", async () => {
          const name = freshName();
          const groupId = `${TENANT}/labelled-drop`;
          const objectStore = new InMemoryObjectStore();
          await stageOffloaded({
            name,
            groupId,
            objectStore,
            extra: {
              __pipelineName: "billing",
              __jobType: "fold",
              __jobName: "gatewayBudgetSync",
            },
          });

          for (const uri of [...objectStore.store.keys()]) {
            objectStore.store.set(uri, Buffer.from("not a valid gzip body"));
          }

          newQueue({
            name,
            processFn: async () => {},
            consumerEnabled: true,
            objectStore,
          });

          await vi.waitFor(
            async () => {
              expect(await dropsFor(name)).toHaveLength(1);
            },
            { timeout: 10000, interval: 100 },
          );

          const [entry] = await dropsFor(name);
          // The whole point of the full label set: a bare {queue_name, reason}
          // can't tell a dropped UI broadcast from a dropped billing event.
          // Asserting the exact identity (not just "non-zero") is deliberate —
          // "unknown" in any of these fields would still make this pass a
          // weaker assertion, and "unknown" is exactly the failure this AC
          // exists to catch.
          expect(entry!.value).toBe(1);
          expect(entry!.labels).toEqual({
            queue_name: name,
            pipeline_name: "billing",
            job_type: "fold",
            job_name: "gatewayBudgetSync",
            reason: "body_unreadable",
          });
        });
      });
    });

    describe("given a group whose staged job cannot be decoded", () => {
      describe("when a worker claims the group and the decode fails", () => {
        it("does not move the group to the blocked set", async () => {
          const name = freshName();
          const groupId = `${TENANT}/stays-live`;
          const objectStore = new InMemoryObjectStore();
          await stageOffloaded({ name, groupId, objectStore });

          for (const uri of [...objectStore.store.keys()]) {
            objectStore.store.set(uri, Buffer.from("not a valid gzip body"));
          }

          newQueue({
            name,
            processFn: async () => {},
            consumerEnabled: true,
            objectStore,
          });

          await vi.waitFor(
            async () => {
              expect(await dropsFor(name)).toHaveLength(1);
            },
            { timeout: 10000, interval: 100 },
          );

          // dropStagedJob completes the slot (scripts.complete) rather than
          // parking it (restageAndBlock) — a missing/unreadable body never
          // comes back, so parking would freeze the aggregate forever.
          expect(await blockedMembers(name)).not.toContain(groupId);
        });

        /** @scenario a decode failure leaves the group live for its next job */
        it("dispatches the next job staged under the same group id normally", async () => {
          const name = freshName();
          const groupId = `${TENANT}/next-job-dispatches`;
          const objectStore = new InMemoryObjectStore();
          await stageOffloaded({ name, groupId, objectStore });

          for (const uri of [...objectStore.store.keys()]) {
            objectStore.store.set(uri, Buffer.from("not a valid gzip body"));
          }

          const processed = vi.fn<(p: TestPayload) => Promise<void>>();
          const consumer = newQueue({
            name,
            processFn: processed,
            consumerEnabled: true,
            objectStore,
          });
          await consumer.waitUntilReady();

          await vi.waitFor(
            async () => {
              expect(await dropsFor(name)).toHaveLength(1);
            },
            { timeout: 10000, interval: 100 },
          );

          await consumer.send({ id: "next", groupId, value: "small-ok-value" });

          await vi.waitFor(
            () => {
              expect(processed).toHaveBeenCalledTimes(1);
            },
            { timeout: 5000, interval: 50 },
          );
          expect(processed.mock.calls[0]![0].id).toBe("next");
        });
      });
    });

    describe("given a group whose completed-jobs count is known", () => {
      describe("when a worker claims the group and the staged job is dropped on decode failure", () => {
        /** @scenario a dropped job is not counted as a completed job */
        it("leaves the completed-jobs count unchanged", async () => {
          const name = freshName();
          const groupId = `${TENANT}/completed-count`;
          const objectStore = new InMemoryObjectStore();
          await stageOffloaded({ name, groupId, objectStore });

          for (const uri of [...objectStore.store.keys()]) {
            objectStore.store.set(uri, Buffer.from("not a valid gzip body"));
          }

          // A prior genuine success, so "unchanged" is a real before/after
          // comparison rather than a vacuous null-stays-null check.
          await redis.set(`${name}:gq:stats:completed`, "3");

          newQueue({
            name,
            processFn: async () => {},
            consumerEnabled: true,
            objectStore,
          });

          await vi.waitFor(
            async () => {
              expect(await dropsFor(name)).toHaveLength(1);
            },
            { timeout: 10000, interval: 100 },
          );

          // Revert-check: before the fix, the drop path's complete() call had
          // no way to signal "discarded, not processed" — COMPLETE_LUA always
          // INCRd stats:completed, so this would read "4".
          expect(await completedStat(name)).toBe("3");
        });
      });
    });

    describe("given a group carrying a recorded error from a previous failure", () => {
      describe("when a worker claims the group and the staged job is dropped on decode failure", () => {
        /** @scenario a dropped job does not erase the group's recorded error */
        it("leaves the group's recorded error intact", async () => {
          const name = freshName();
          const groupId = `${TENANT}/error-survives`;
          const objectStore = new InMemoryObjectStore();
          await stageOffloaded({ name, groupId, objectStore });

          for (const uri of [...objectStore.store.keys()]) {
            objectStore.store.set(uri, Buffer.from("not a valid gzip body"));
          }

          await redis.hset(
            `${name}:gq:group:${groupId}:error`,
            "message",
            "boom from a previous failure",
          );

          newQueue({
            name,
            processFn: async () => {},
            consumerEnabled: true,
            objectStore,
          });

          await vi.waitFor(
            async () => {
              expect(await dropsFor(name)).toHaveLength(1);
            },
            { timeout: 10000, interval: 100 },
          );

          // Revert-check: COMPLETE_LUA's pre-fix behaviour unconditionally
          // DEL'd this key on every completion, including a discarded job —
          // so ops lost the diagnostic trail for the failure right when a new
          // one occurred.
          expect(await storedErrorMessage(name, groupId)).toBe(
            "boom from a previous failure",
          );
        });
      });
    });

    describe("given a staged job whose blob store is temporarily unreachable", () => {
      describe("when a worker claims the group and the decode fails", () => {
        /** @scenario a transient blob-store error still retries instead of dropping */
        it(
          "re-stages the job for retry instead of completing it",
          async () => {
            const name = freshName();
            const groupId = `${TENANT}/transient-retries`;
            const flaky = new FlakyObjectStore(1); // fails once, then serves
            const received: TestPayload[] = [];
            newQueue({
              name,
              processFn: async (p) => {
                received.push(p);
              },
              consumerEnabled: true,
              objectStore: flaky,
            });

            await queues[0]!.waitUntilReady();
            await queues[0]!.send({
              id: "s1",
              groupId,
              value: OFFLOADABLE_S3_VALUE(),
            });

            // The handler eventually runs despite the first transient
            // failure — it could only get here via a re-stage, since a drop
            // would never call the handler at all.
            await vi.waitFor(() => expect(received).toHaveLength(1), {
              timeout: 15000,
              interval: 100,
            });
          },
          20000,
        );

        it(
          "does not increment the drop counter",
          async () => {
            const name = freshName();
            const groupId = `${TENANT}/transient-no-drop`;
            const flaky = new FlakyObjectStore(1);
            const received: TestPayload[] = [];
            newQueue({
              name,
              processFn: async (p) => {
                received.push(p);
              },
              consumerEnabled: true,
              objectStore: flaky,
            });

            await queues[0]!.waitUntilReady();
            await queues[0]!.send({
              id: "s1",
              groupId,
              value: OFFLOADABLE_S3_VALUE(),
            });

            await vi.waitFor(() => expect(received).toHaveLength(1), {
              timeout: 15000,
              interval: 100,
            });

            // Revert-check: pre-fix, TransientBlobStoreError still routed
            // through handleTransientDecode (this was already correct before
            // #5538 — see ADR-030 §2), so this specific assertion mainly
            // guards against a regression that widens the drop path to catch
            // transient errors too.
            expect(await dropsFor(name)).toHaveLength(0);
          },
          20000,
        );
      });
    });

    describe("given a staged job whose blob store stays unreachable for every retry attempt", () => {
      describe("when the job exhausts its retry budget", () => {
        /** @scenario the transient retry ladder's terminal counts the job it gives up on */
        it("increments the drop counter with the transient-exhausted reason", async () => {
          const name = freshName();
          const groupId = `${TENANT}/transient-exhausted`;
          // handleTransientDecode derives the attempt number from the
          // stagedJobId's own "/r/" suffix count
          // (stagedJobId.match(/\/r\//g)), not from a live retry counter —
          // so staging a job whose id already carries
          // JOB_RETRY_CONFIG.maxAttempts - 1 = 24 markers hits the exhaustion
          // branch on the FIRST claim. This sidesteps ~2h of real exponential
          // backoff (25 attempts, capped at 600s each) with no fake timers.
          const craftedStagedJobId = `victim${"/r/x".repeat(24)}`;

          const flaky = new FlakyObjectStore(1); // one failure is all that's needed
          const encodeTiered = new TieredBlobStore({
            redisBlobs: new InMemoryJobBlobStore(),
            objectStoreFor: () => flaky,
            resolveDestination: STORAGE_DESTINATION,
          });
          const envelope = await encodeJobEnvelope({
            jobData: {
              id: "victim",
              groupId,
              value: OFFLOADABLE_S3_VALUE(),
              __pipelineName: "billing",
              __jobType: "fold",
              __jobName: "gatewayBudgetSync",
            },
            tieredBlobs: encodeTiered,
            projectId: PROJECT,
            writesEnabled: true,
            queueName: name,
          });

          const scripts = new GroupStagingScripts(redis, name);
          await scripts.stageBatch([
            {
              stagedJobId: craftedStagedJobId,
              groupId,
              dispatchAfterMs: Date.now(),
              dedupId: "",
              dedupTtlMs: 0,
              jobDataJson: envelope,
            },
          ]);
          // The stage transaction publishes the lease with the job. Without
          // this assertion, the later no-delete check could pass vacuously.
          expect(await redis.keys(`${name}:gq:blobleases:*`)).toHaveLength(1);

          newQueue({
            name,
            processFn: async () => {},
            consumerEnabled: true,
            objectStore: flaky,
          });

          await vi.waitFor(
            async () => {
              expect(await dropsFor(name)).toHaveLength(1);
            },
            { timeout: 10000, interval: 100 },
          );

          const [entry] = await dropsFor(name);
          // Revert-check: before #5538 this terminal never counted the loss —
          // an operator saw nothing while an event that could not recover via
          // replay was thrown away.
          expect(entry!.labels.reason).toBe("transient_exhausted");
          // The terminal retires its lease but leaves shared object bytes to
          // the durable-store lifecycle.
          expect(await redis.keys(`${name}:gq:blobleases:*`)).toHaveLength(0);
          expect(flaky.deleted).toEqual([]);
        });
      });
    });

    describe("given a body-present drop carrying a recovery key (#719/#718)", () => {
      describe("when a worker claims the group and the decode fails", () => {
        /** @scenario a body-present reactor drop is dead-lettered with its recovery key */
        it("preserves the value in the dead-letter, labelled and keyed", async () => {
          const name = freshName();
          const groupId = `${TENANT}/dlq-body-present`;
          const objectStore = new InMemoryObjectStore();
          await stageOffloaded({
            name,
            groupId,
            objectStore,
            extra: { __recoveryKey: "evt-1" },
          });
          // Body present but unreadable (codec skew), NOT evicted.
          for (const uri of [...objectStore.store.keys()]) {
            objectStore.store.set(uri, Buffer.from("not a valid gzip body"));
          }
          newQueue({
            name,
            processFn: async () => {},
            consumerEnabled: true,
            objectStore,
          });

          // Poll the recovery SIDE EFFECT (DLQ written, live value gone) rather
          // than the drop metric directly: waiting on the side effect is the
          // robust condition regardless of exactly when recordDrop fires
          // relative to the DLQ write (review #5853 moved recordDrop to fire
          // only after the write succeeds, so the metric below is no longer
          // racing it either — but the side effect remains the thing this test
          // is actually about).
          await vi.waitFor(
            async () => {
              expect(await dlqValue(name, groupId, "victim")).not.toBeNull();
              expect(await liveValue(name, groupId, "victim")).toBeNull();
            },
            { timeout: 10000, interval: 100 },
          );

          // AC-719.1: preserved in the dead-letter, gone from live staging.
          // Revert-check: before #719 the drop only called complete(), so the
          // value was deleted and the waitFor above times out.
          const preserved = await dlqValue(name, groupId, "victim");
          expect(preserved).not.toBeNull();
          // AC-719.3: labelled with the failure class.
          expect(await dlqReason(name, groupId, "victim")).toBe("body_unreadable");
          // AC-718.2: the quarantined reactor job is addressable by its event id.
          expect(readJobRecoveryKey(preserved!)).toBe("evt-1");
          // The drop is counted: recordDrop now fires only after the DLQ write
          // above succeeded, so by the time the side effect is observed the
          // metric is already incremented — no race.
          expect(await dropsFor(name)).toHaveLength(1);
        });
      });
    });

    describe("given a missing-blob drop carrying a recovery key (#718.2b/#719.2)", () => {
      describe("when a worker claims the group and the blob is genuinely gone", () => {
        /** @scenario a missing-blob reactor drop is named in the log but not dead-lettered */
        it("does not dead-letter and releases the absent blob's holder", async () => {
          const name = freshName();
          const groupId = `${TENANT}/dlq-missing-blob`;
          const objectStore = new InMemoryObjectStore();
          await stageOffloaded({
            name,
            groupId,
            objectStore,
            extra: { __recoveryKey: "evt-1" },
          });
          // Genuinely gone (eviction / purge), not corrupt — delete the object.
          for (const uri of [...objectStore.store.keys()]) {
            objectStore.store.delete(uri);
          }
          const consumer = newQueue({
            name,
            processFn: async () => {},
            consumerEnabled: true,
            objectStore,
          });
          // Once the blob is gone the recoveryKey is the ONLY recovery identifier,
          // and it rides the structured drop LOG (recordDrop) — not the metric,
          // not Redis. Capture the log at the seam to prove it actually carries
          // "evt-1" (RaiMf). Installed synchronously before any async drop runs.
          const dropLog = vi.spyOn((consumer as any).logger, "error");

          // Wait on the drop LOG itself (installed synchronously above), not
          // objectStore.deleted: lease release is non-destructive under the
          // new BlobLeases model (bytes reclaim lazily via TTL, never an
          // eager S3 delete on release — unlike the old BlobHolders design),
          // so there is no S3-delete side effect to poll here anymore. The
          // stale lease is still released (`releaseLease`, unit-tested
          // directly in groupQueue.deadLetterFallback.unit.test.ts's
          // missing_blob case); this integration test's job is the
          // externally-observable contract below.
          await vi.waitFor(
            () => {
              expect(dropLog).toHaveBeenCalled();
            },
            { timeout: 10000, interval: 100 },
          );

          // The body is GONE, so there is nothing to preserve: no dead-letter
          // entry is written, and the stale lease is released rather than
          // leaked. This is the honest boundary — a missing_blob reactor drop
          // is NAMED (recoveryKey rides the drop log via recordDrop) but NOT
          // recovered.
          expect(await dlqValue(name, groupId, "victim")).toBeNull();
          const [entry] = await dropsFor(name);
          expect(entry!.labels.reason).toBe("missing_blob");
          // AC-718.2b: the drop log names the exact event that was lost — the sole
          // recovery identifier after the blob is gone. Revert-check: drop the
          // header.k lift and recoveryKey logs as null here.
          expect(dropLog).toHaveBeenCalledWith(
            expect.objectContaining({
              recoveryKey: "evt-1",
              reason: "missing_blob",
            }),
            expect.any(String),
          );
        });
      });
    });

    describe("given a body-present job quarantined in the dead-letter (#719 recovery)", () => {
      describe("when an operator drains the group's dead-letter", () => {
        /** @scenario draining the dead-letter restores the job to live staging and it dispatches */
        it("restores it to live staging byte-identical and it dispatches", async () => {
          const name = freshName();
          const groupId = `${TENANT}/dlq-replay`;
          const objectStore = new InMemoryObjectStore();
          await stageOffloaded({
            name,
            groupId,
            objectStore,
            extra: { __recoveryKey: "evt-1" },
          });

          // Save the good bytes, then corrupt so the first claim drops it to the
          // dead-letter (the rolling-deploy codec-skew shape).
          const [uri] = [...objectStore.store.keys()];
          const goodBytes = Buffer.from(objectStore.store.get(uri!)!);
          objectStore.store.set(uri!, Buffer.from("not a valid gzip body"));

          const processed = vi.fn<(p: TestPayload) => Promise<void>>();
          const consumer = newQueue({
            name,
            processFn: processed,
            consumerEnabled: true,
            objectStore,
          });
          await consumer.waitUntilReady();

          await vi.waitFor(
            async () => {
              expect(await dlqValue(name, groupId, "victim")).not.toBeNull();
            },
            { timeout: 10000, interval: 100 },
          );
          const preserved = await dlqValue(name, groupId, "victim");

          // A newer worker can now read the body (the rollout has completed).
          objectStore.store.set(uri!, goodBytes);

          // The operator drains via the EXISTING group-scoped drain — unchanged.
          // That it recovers a job-scoped entry proves the key layout matches.
          const ops = new QueueRedisRepository(redis);
          const { jobsReplayed } = await ops.replayFromDlq({
            queueName: name,
            groupId,
          });
          expect(jobsReplayed).toBe(1);

          // Restored byte-identical to live staging, and gone from the dead-letter.
          expect(await liveValue(name, groupId, "victim")).toBe(preserved);
          expect(await dlqValue(name, groupId, "victim")).toBeNull();

          // And it actually dispatches + processes now the body reads, with the
          // queue machinery (incl. __recoveryKey) stripped from the handler payload.
          await vi.waitFor(
            () => {
              expect(processed).toHaveBeenCalledTimes(1);
            },
            { timeout: 10000, interval: 100 },
          );
          expect(processed.mock.calls[0]![0].id).toBe("victim");
          expect(processed.mock.calls[0]![0]).not.toHaveProperty("__recoveryKey");
        });
      });
    });

    describe("given a body-present GQ2 drop (#720 blob lifetime)", () => {
      describe("when the job is dead-lettered", () => {
        /** @scenario a dead-lettered GQ2 job's blob holder outlives the dead-letter window */
        it("extends the blob holder past the dead-letter quarantine window", async () => {
          const name = freshName();
          const groupId = `${TENANT}/dlq-blob-ttl`;
          const objectStore = new InMemoryObjectStore();
          await stageOffloaded({ name, groupId, objectStore });

          // The send() path acquired a holder — so pttl is a real TTL, not -2
          // (the harness's batch-stage path would bypass acquire).
          const holderKeys = await redis.keys(`${name}:gq:blobholders:*`);
          expect(holderKeys).toHaveLength(1);

          for (const uri of [...objectStore.store.keys()]) {
            objectStore.store.set(uri, Buffer.from("not a valid gzip body"));
          }
          newQueue({
            name,
            processFn: async () => {},
            consumerEnabled: true,
            objectStore,
          });

          await vi.waitFor(
            async () => {
              expect(await dlqValue(name, groupId, "victim")).not.toBeNull();
            },
            { timeout: 10000, interval: 100 },
          );

          // The blob's holder must be preserved to the SAME dead-letter window as
          // the entry it backs, or a drain would recover an envelope pointing at a
          // reclaimed blob. Compare against the ACTUAL DLQ data-key TTL rather than
          // a magic 6-day threshold (RaiMk): preserveForDlq extends the holder just
          // BEFORE the DLQ write, so the holder's remaining TTL tracks the entry's
          // within write latency (5s slack) — it does not expire before it.
          const holderPttl = await redis.pttl(holderKeys[0]!);
          const dlqDataPttl = await redis.pttl(`${name}:gq:dlq:${groupId}:data`);
          expect(dlqDataPttl).toBeGreaterThan(0);
          expect(holderPttl).toBeGreaterThan(dlqDataPttl - 5_000);
          // Falsifiability retained: the legacy holder-mirror key's default TTL is
          // BLOB_LEASE_SET_TTL_SECONDS (4 days), so > 6 days proves preserveForDlq
          // pushed it to the window. Revert preserveForDlq and this drops back to
          // ~4d → red.
          expect(holderPttl).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
        });
      });
    });

    describe("given a coalesced batch whose drained sibling is dead-lettered (#5853 release fix)", () => {
      describe("when the dispatched job succeeds", () => {
        /** @scenario a dead-lettered drained sibling's blob survives the batch's success */
        it("does not release the dropped sibling's preserved blob on the batch's success", async () => {
          const name = freshName();
          const groupId = `${TENANT}/coalesce-release`;
          const objectStore = new InMemoryObjectStore();

          // Stage TWO offloaded jobs in the same group with a consumer-less queue
          // so corruption can't race the dispatcher: J (dispatched, decodes fine)
          // first, then S2 (the drained sibling). incompressible() is random per
          // call, so the two get distinct blobs.
          const staging = newQueue({
            name,
            processFn: async () => {},
            consumerEnabled: false,
            objectStore,
          });
          await staging.waitUntilReady();
          await staging.send({
            id: "dispatched",
            groupId,
            value: OFFLOADABLE_S3_VALUE(),
          });
          const jUris = new Set(objectStore.store.keys());
          await staging.send({
            id: "sibling",
            groupId,
            value: OFFLOADABLE_S3_VALUE(),
          });
          const s2Uri = [...objectStore.store.keys()].find((u) => !jUris.has(u));
          expect(s2Uri).toBeDefined();

          // Corrupt ONLY the sibling's blob: body present, unreadable to this
          // worker (the codec-skew case #719 targets) — NOT evicted.
          objectStore.store.set(s2Uri!, Buffer.from("not a valid gzip body"));

          // Coalescing consumer: dispatches J, drains S2 as a sibling, S2 decode
          // fails → dead-lettered, J's handler succeeds → the success-path release
          // runs. maxBatch > 1 + processBatch is what turns coalescing on.
          const processed = vi.fn<(p: TestPayload) => Promise<void>>();
          processed.mockResolvedValue(undefined);
          newQueue({
            name,
            processFn: processed,
            consumerEnabled: true,
            objectStore,
            processBatch: async () => {},
            coalesceMaxBatch: () => 50,
          });

          // Wait until S2 is dead-lettered AND the dispatched job completed
          // (a real completion, not a drop — completedStat is only bumped by a
          // non-dropped complete()).
          await vi.waitFor(
            async () => {
              expect(
                await redis.hlen(`${name}:gq:dlq:${groupId}:data`),
              ).toBe(1);
              expect(await completedStat(name)).not.toBeNull();
            },
            { timeout: 15000, interval: 100 },
          );

          // The fix: the dispatched job's success released only its OWN blob, not
          // the dropped sibling's PRESERVED blob. Revert the fix (release every
          // drainedSibling) and S2's blob is UNLINKed here → its dead-letter entry
          // points at a gone blob and a drain recovers a bodyless envelope. This
          // is the exact use-after-free the adversarial review found.
          expect(objectStore.deleted).not.toContain(s2Uri);
          expect(objectStore.store.has(s2Uri!)).toBe(true);
        });
      });
    });
  },
);
