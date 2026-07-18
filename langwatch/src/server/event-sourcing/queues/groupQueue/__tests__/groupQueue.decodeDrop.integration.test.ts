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
import { EnvelopeBlobLifecycle } from "../envelopeBlobLifecycle";
import { GroupQueueProcessor } from "../groupQueue";
import { encodeJobEnvelope, readEnvelopeHold } from "../jobEnvelope";
import { gqJobsDroppedTotal } from "../metrics";
import { GroupStagingScripts } from "../scripts";
import { TieredBlobStore } from "../tieredBlobStore";
import {
  FlakyObjectStore,
  InMemoryJobBlobStore,
  InMemoryObjectStore,
  incompressible,
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
};

// Tenant prefix for groupIds so GQ2 (content-addressed, tenant-namespaced)
// offload activates — see jobEnvelope.ts's projectIdFor / tenantIdFromGroupId.
const TENANT = "proj1";
const PROJECT = createTenantId(TENANT);
const STORAGE_DESTINATION = async () => ({
  kind: "s3" as const,
  bucket: "test-bucket",
});

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
      processBatch,
      consumerEnabled,
      objectStore,
      score,
    }: {
      name: string;
      processFn: (payload: TestPayload) => Promise<void>;
      processBatch?: (payloads: TestPayload[]) => Promise<void>;
      consumerEnabled: boolean;
      objectStore: InMemoryObjectStore;
      score?: (payload: TestPayload) => number;
    }): GroupQueueProcessor<TestPayload> {
      const definition: EventSourcedQueueDefinition<TestPayload> = {
        name,
        groupKey: (p) => p.groupId,
        process: processFn,
        ...(processBatch ? { processBatch, coalesceMaxBatch: () => 50 } : {}),
        ...(score ? { score } : {}),
      };
      const queue = new GroupQueueProcessor<TestPayload>(definition, redis, {
        consumerEnabled,
        objectStoreFor: () => objectStore,
        resolveStorageDestination: STORAGE_DESTINATION,
      });
      queues.push(queue);
      return queue;
    }

    const blockedMembers = (name: string) =>
      redis.smembers(`${name}:gq:blocked`);
    const storedErrorMessage = (name: string, groupId: string) =>
      redis.hget(`${name}:gq:group:${groupId}:error`, "message");
    const completedStat = (name: string) =>
      redis.get(`${name}:gq:stats:completed`);

    /** All `gq_jobs_dropped_total` samples recorded for this test's queue. */
    async function dropsFor(name: string) {
      const metric = await gqJobsDroppedTotal.get();
      return metric.values.filter((v) => v.labels.queue_name === name);
    }

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

    async function stageOffloadedBatch({
      name,
      groupId,
      objectStore,
    }: {
      name: string;
      groupId: string;
      objectStore: InMemoryObjectStore;
    }): Promise<void> {
      const staging = newQueue({
        name,
        processFn: async () => {},
        consumerEnabled: false,
        objectStore,
        score: (payload) => payload.id.charCodeAt(0),
      });
      await staging.waitUntilReady();
      for (const id of ["A", "B", "C"]) {
        await staging.send({
          id,
          groupId,
          value: OFFLOADABLE_S3_VALUE(),
        });
      }
    }

    async function bodyUnreadableDropCount(name: string): Promise<number> {
      return (await dropsFor(name))
        .filter((entry) => entry.labels.reason === "body_unreadable")
        .reduce((sum, entry) => sum + entry.value, 0);
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
        if (this.putsLeft <= 0)
          throw new Error("blob store unavailable on write");
        this.putsLeft--;
        return super.put(uri, bytes);
      }
    }

    class SelectiveFlakyObjectStore extends InMemoryObjectStore {
      transientUri?: string;
      private failed = false;

      override async get(uri: string) {
        if (uri === this.transientUri && !this.failed) {
          this.failed = true;
          throw new Error("transient ECONNRESET");
        }
        return super.get(uri);
      }
    }

    describe("given a coalesced batch with a terminally dropped sibling", () => {
      describe("when the handler fails after sibling parsing", () => {
        it("re-stages healthy siblings without resurrecting the dropped sibling", async () => {
          const name = freshName();
          const groupId = `${TENANT}/batch-handler-failure`;
          const objectStore = new InMemoryObjectStore();
          await stageOffloadedBatch({ name, groupId, objectStore });

          const uris = [...objectStore.store.keys()];
          expect(uris).toHaveLength(3);
          objectStore.store.set(uris[1]!, Buffer.from("not a valid gzip body"));

          let batchAttempts = 0;
          const succeeded = new Set<string>();
          const consumer = newQueue({
            name,
            processFn: async (payload) => {
              succeeded.add(payload.id);
            },
            processBatch: async (payloads) => {
              batchAttempts++;
              if (batchAttempts === 1) {
                throw new Error("simulated batch failure");
              }
              for (const payload of payloads) {
                succeeded.add(payload.id);
              }
            },
            consumerEnabled: true,
            objectStore,
          });
          await consumer.waitUntilReady();

          await vi.waitFor(
            () => {
              expect(succeeded).toEqual(new Set(["A", "C"]));
            },
            { timeout: 45000, interval: 100 },
          );
          expect(await bodyUnreadableDropCount(name)).toBe(1);
        });
      });

      describe("when another sibling has a transient parse failure", () => {
        it("settles every parse before re-staging only the retryable siblings", async () => {
          const name = freshName();
          const groupId = `${TENANT}/mixed-parse-failures`;
          const objectStore = new SelectiveFlakyObjectStore();
          await stageOffloadedBatch({ name, groupId, objectStore });

          const uris = [...objectStore.store.keys()];
          expect(uris).toHaveLength(3);
          objectStore.store.set(uris[1]!, Buffer.from("not a valid gzip body"));
          objectStore.transientUri = uris[2]!;

          const succeeded = new Set<string>();
          const consumer = newQueue({
            name,
            processFn: async (payload) => {
              succeeded.add(payload.id);
            },
            processBatch: async (payloads) => {
              for (const payload of payloads) {
                succeeded.add(payload.id);
              }
            },
            consumerEnabled: true,
            objectStore,
          });
          await consumer.waitUntilReady();

          await vi.waitFor(
            () => {
              expect(succeeded).toEqual(new Set(["A", "C"]));
            },
            { timeout: 45000, interval: 100 },
          );
          expect(await bodyUnreadableDropCount(name)).toBe(1);
        });
      });
    });

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
          // Unlike every other reason, this one SHOULD release: the body was
          // already read, so keeping it buys a later worker nothing — and holding
          // it would leak the hold to the 4-day TTL backstop.
          expect(objectStore.deleted.length).toBeGreaterThan(0);
          // AC8 still holds here: a discard is not a completion.
          expect(await completedStat(name)).toBeNull();
        });
      });
    });

    describe("given a staged job whose body is present but cannot be decoded", () => {
      describe("when a worker claims the group and the decode fails", () => {
        /** @scenario a body-present decode failure does not destroy the body it could not read */
        it("does not release the blob", async () => {
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
          // The revert-check: before #5538's fix this path called release(),
          // which for an s3-tier blob means tieredBlobs.delete() — recorded
          // here. Reverting the fix turns this into a non-empty array.
          expect(objectStore.deleted).toEqual([]);
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
        /** @scenario a missing-blob drop releases the absent blob's holder */
        it("releases the blob's holder", async () => {
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

          // The stated exemption (AC2a): a missing_blob drop DOES release —
          // there is nothing left to preserve, so the holder is dropped.
          // Revert-check: this currently passes either way (release() always
          // ran pre-fix); its value is guarding the *other* reason branches
          // don't regress into skipping this legitimate release.
          await vi.waitFor(
            () => {
              expect(objectStore.deleted).toContain(uri);
            },
            { timeout: 5000, interval: 50 },
          );
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
        it("re-stages the job for retry instead of completing it", async () => {
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
        }, 20000);

        it("does not increment the drop counter", async () => {
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
        }, 20000);
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

          // Acquire the holder that `send()` would have. Staging via
          // encodeJobEnvelope + stageBatch bypasses `blobLifecycle.acquire()`, so
          // WITHOUT this there is no holder — release() would delete nothing and
          // `flaky.deleted === []` would pass even with the fix reverted. Caught
          // by review after I shipped exactly that vacuous assertion; verified by
          // reverting the release rule and watching this test stay green.
          const lifecycle = new EnvelopeBlobLifecycle({
            redis,
            queueName: name,
            objectStoreFor: () => flaky,
            resolveStorageDestination: STORAGE_DESTINATION,
          });
          await lifecycle.acquire(envelope);
          expect(readEnvelopeHold(envelope)).not.toBeNull(); // the holder is real

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
          // Revert-check: before #5538, this terminal called release() AND
          // never counted the loss — an operator saw nothing while an event
          // that could not possibly recover via replay was thrown away.
          expect(entry!.labels.reason).toBe("transient_exhausted");
          // The terminal's OTHER deliberate change, which had no coverage until a
          // review caught it: it no longer releases. Eight failed READS mean the
          // STORE was unreachable, not that the blob is gone — most likely it is
          // still there, so retiring it would delete a body that exists.
          expect(flaky.deleted).toEqual([]);
        });
      });
    });
  },
);
