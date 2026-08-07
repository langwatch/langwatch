/**
 * Durability of the DRAINED-sibling dead-letter path (#5853 C4 review).
 *
 * A drained value has already left live staging by the time it is dead-lettered,
 * so — unlike the dispatch/transient sites, which withhold `complete()` until
 * AFTER the dead-letter write (copy-before-complete) — there is no slot to hold
 * open. Two review findings hinge on that asymmetry:
 *
 *  - Critical (RaiMx): if the dead-letter write rejects, nothing re-stages the
 *    raw value, so drained work can vanish while comments claim atomic
 *    durability. `deadLetterDrainedValue` closes the gap with a re-stage
 *    fallback.
 *  - Major (RaiMv): the sibling re-stage `catch` used to cover `renewLease()`
 *    too, so a lease hiccup AFTER a successful `stage()` would dead-letter a
 *    job that is already back in live staging — duplicating it and
 *    double-processing after a drain. `renewLease()` now sits outside that
 *    `catch`.
 *  - P2 (Aryansharma28): both drained sites claimed the drop BEFORE attempting
 *    the dead-letter, so the re-stage fallback above — a designed path on which
 *    nothing is thrown away — was counted in `gq_jobs_dropped_total`, and
 *    re-counted on every drain cycle for as long as the write kept failing. The
 *    tally now follows the outcome the attempt reports.
 *
 * These exercise the private seams directly because the per-site coalesced-batch
 * fault-injection harness is deferred (AC-719.5/719.7 @unimplemented); the real
 * Redis round-trip is covered by groupQueue.decodeDrop.integration.test.ts.
 */

import { Redis as IORedis } from "ioredis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventSourcedQueueDefinition } from "../../queue.types";
import { GroupQueueProcessor } from "../groupQueue";
import { DecodeFailureError } from "../jobEnvelope";
import { gqDrainedDlqRestagedTotal, gqJobsDroppedTotal } from "../metrics";
import type { DrainedJob } from "../scripts";

// Mirror groupQueue.blockingConnection.unit.test.ts: mock the collaborators the
// processor instantiates with `new` in consumer mode so no BRPOP loop or metrics
// setInterval opens a handle that outlives the test. Classes stay constructible
// under Vitest 4.x (an arrow factory is not a constructor).
vi.mock("../dispatcher", () => ({
  GroupQueueDispatcher: class {
    start(): void {}
    requestShutdown(): void {}
    async waitUntilStopped(): Promise<void> {}
  },
}));

vi.mock("../metricsCollector", () => ({
  GroupQueueMetricsCollector: class {
    start(): void {}
    stop(): void {}
  },
}));

type TestPayload = { id: string; groupId: string };

const GROUP_ID = "proj1/drained-durability";
const RAW_VALUE = '{"id":"sib-1","groupId":"proj1/drained-durability"}';

function makeDefinition(): EventSourcedQueueDefinition<TestPayload> {
  return {
    name: `{test/gq/dlqfb/${crypto.randomUUID().slice(0, 8)}}`,
    process: async () => {},
    groupKey: (p) => p.groupId,
  };
}

/**
 * A score the re-stage guard accepts unchanged (Nov 2023 — above
 * `MIN_PLAUSIBLE_EPOCH_MS`). It has to be a real timestamp: `restageScore` heals
 * anything below that floor to the staging clock, so an arbitrary small number
 * here would assert that an implausible score is written back verbatim, which is
 * the defect the guard exists to prevent.
 */
const PLAUSIBLE_SCORE = 1_700_000_000_000;

function makeSibling(): DrainedJob {
  return {
    stagedJobId: "sib-1",
    jobDataJson: RAW_VALUE,
    originalScore: PLAUSIBLE_SCORE,
  };
}

/**
 * Shared spy harness. A helper rather than a common parent `describe` so neither
 * top-level block exceeds the 60-line function budget Biome enforces on new code.
 * Returns getters because the instances are rebuilt per test.
 */
function useSpyProcessor() {
  let conn: IORedis;
  let processor: GroupQueueProcessor<TestPayload>;
  let scripts: {
    stage: ReturnType<typeof vi.fn>;
    writeJobToDlq: ReturnType<typeof vi.fn>;
  };
  let blobLifecycle: {
    preserveForDlq: ReturnType<typeof vi.fn>;
    renewLease: ReturnType<typeof vi.fn>;
    decode: ReturnType<typeof vi.fn>;
    releaseLease: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    conn = new IORedis({ lazyConnect: true, maxRetriesPerRequest: 0 });
    processor = new GroupQueueProcessor<TestPayload>(makeDefinition(), conn, {
      consumerEnabled: false,
    });
    // Swap the real Redis-backed collaborators for spies so we can inject
    // dead-letter / re-stage failures without a live server.
    scripts = { stage: vi.fn(), writeJobToDlq: vi.fn() };
    blobLifecycle = {
      preserveForDlq: vi.fn(),
      renewLease: vi.fn(),
      decode: vi.fn(),
      releaseLease: vi.fn(),
    };
    (processor as any).scripts = scripts;
    (processor as any).blobLifecycle = blobLifecycle;
  });

  afterEach(() => {
    conn.disconnect();
    vi.restoreAllMocks();
  });
  return {
    get processor() {
      return processor;
    },
    get scripts() {
      return scripts;
    },
    get blobLifecycle() {
      return blobLifecycle;
    },
    /**
     * This test's own queue name — every test builds a fresh random one, so the
     * counter samples below are this test's and nothing else's. The registry is
     * process-global and never reset, so filtering by label is what keeps these
     * assertions from reading another test's increments.
     */
    get queueName(): string {
      return (processor as any).queueName as string;
    },
  };
}

/** Total `gq_jobs_dropped_total` recorded for one queue, across every reason. */
async function discardsCounted(queueName: string): Promise<number> {
  const metric = await gqJobsDroppedTotal.get();
  return metric.values
    .filter((v) => v.labels.queue_name === queueName)
    .reduce((sum, v) => sum + v.value, 0);
}

/** Total `gq_drained_dlq_restaged_total` recorded for one queue. */
async function putBacksCounted(queueName: string): Promise<number> {
  const metric = await gqDrainedDlqRestagedTotal.get();
  return metric.values
    .filter((v) => v.labels.queue_name === queueName)
    .reduce((sum, v) => sum + v.value, 0);
}

describe("GroupQueueProcessor drained-sibling dead-letter durability — write failures", () => {
  const h = useSpyProcessor();

  describe("given the dead-letter write fails for a value already out of staging", () => {
    describe("when deadLetterDrainedValue runs", () => {
      /** @scenario a drained value whose dead-letter write fails is re-staged not lost */
      it("re-stages the raw value so the drop stays recoverable instead of vanishing", async () => {
        h.blobLifecycle.preserveForDlq.mockResolvedValue(undefined);
        h.scripts.writeJobToDlq.mockRejectedValue(new Error("redis down"));
        h.scripts.stage.mockResolvedValue(undefined);

        await (h.processor as any).deadLetterDrainedValue({
          groupId: GROUP_ID,
          stagedJobId: "sib-1",
          jobDataJson: RAW_VALUE,
          reason: "sibling_restage_failed",
          originalScore: PLAUSIBLE_SCORE,
        });

        // Falsifiability: drop the fallback (call preserveForDlq/writeJobToDlq
        // directly, as before the fix) and stage() is never reached here.
        expect(h.scripts.stage).toHaveBeenCalledTimes(1);
        expect(h.scripts.stage).toHaveBeenCalledWith(
          expect.objectContaining({
            stagedJobId: "sib-1",
            groupId: GROUP_ID,
            jobDataJson: RAW_VALUE,
            dispatchAfterMs: PLAUSIBLE_SCORE,
          }),
        );
        // The hold is re-renewed after a confirmed re-stage (CodeRabbit RcrOU).
        // Asserted because nothing else in this file covers THIS call site — the
        // renewLease assertions further down belong to restageDrainedSiblings's
        // own loop, so without this the line could be deleted and stay green.
        expect(h.blobLifecycle.renewLease).toHaveBeenCalledWith(RAW_VALUE);
      });
    });

    describe("when the value carries an implausible score", () => {
      /** @scenario a re-staged drained value is never put back at an implausible score */
      it("heals the score instead of writing it back unchanged", async () => {
        h.blobLifecycle.preserveForDlq.mockResolvedValue(undefined);
        h.scripts.writeJobToDlq.mockRejectedValue(new Error("redis down"));
        h.scripts.stage.mockResolvedValue(undefined);
        const before = Date.now();

        await (h.processor as any).deadLetterDrainedValue({
          groupId: GROUP_ID,
          stagedJobId: "sib-1",
          jobDataJson: RAW_VALUE,
          reason: "sibling_restage_failed",
          // A legacy row staged before the score guard existed. Unhealed, this
          // is rewritten as 0 on EVERY failed dead-letter write and never
          // recovers, sorting the value ahead of the job it was drained behind.
          originalScore: 0,
        });

        // Asserted before indexing: a fallback that never re-staged at all would
        // otherwise fail on an undefined read rather than on the score.
        expect(h.scripts.stage).toHaveBeenCalledTimes(1);
        const staged = h.scripts.stage.mock.calls[0]![0] as {
          dispatchAfterMs: number;
        };
        expect(staged.dispatchAfterMs).not.toBe(0);
        // Healed to the staging clock, the same way every other re-stage in this
        // class does it — asserted as a range, not a frozen constant, so this
        // pins the property rather than one reading of the clock.
        expect(staged.dispatchAfterMs).toBeGreaterThanOrEqual(before);
        expect(staged.dispatchAfterMs).toBeLessThanOrEqual(Date.now());
      });
    });
  });

  describe("given the dead-letter write succeeds", () => {
    describe("when deadLetterDrainedValue runs", () => {
      it("does not spuriously re-stage a value it just dead-lettered", async () => {
        h.blobLifecycle.preserveForDlq.mockResolvedValue(undefined);
        h.scripts.writeJobToDlq.mockResolvedValue(undefined);
        h.scripts.stage.mockResolvedValue(undefined);

        await (h.processor as any).deadLetterDrainedValue({
          groupId: GROUP_ID,
          stagedJobId: "sib-1",
          jobDataJson: RAW_VALUE,
          reason: "sibling_restage_failed",
          originalScore: PLAUSIBLE_SCORE,
        });

        expect(h.scripts.writeJobToDlq).toHaveBeenCalledTimes(1);
        expect(h.scripts.stage).not.toHaveBeenCalled();
      });
    });
  });

  describe("given both the dead-letter write and the re-stage fallback fail", () => {
    describe("when deadLetterDrainedValue runs", () => {
      it("does not throw — the value survives in the drop log recordDrop wrote", async () => {
        h.blobLifecycle.preserveForDlq.mockResolvedValue(undefined);
        h.scripts.writeJobToDlq.mockRejectedValue(new Error("redis down"));
        h.scripts.stage.mockRejectedValue(new Error("still down"));

        // Must resolve: the caller awaits this inside its batch loop, so a throw
        // here would abort the remaining siblings. It resolves to the branch it
        // took, which is what lets the caller count the right event — a rejection
        // still fails this assertion, so the original "does not throw" is intact.
        await expect(
          (h.processor as any).deadLetterDrainedValue({
            groupId: GROUP_ID,
            stagedJobId: "sib-1",
            jobDataJson: RAW_VALUE,
            reason: "sibling_restage_failed",
            originalScore: PLAUSIBLE_SCORE,
          }),
        ).resolves.toEqual({ branch: "lost" });
      });
    });
  });
});

/**
 * What the DISCARD TALLY is allowed to count (P2 review, Aryansharma28).
 *
 * `gq_jobs_dropped_total` is the only evidence a reactor drop ever happened, so
 * the one thing it must never do is count work that is still in the queue. Both
 * drained sites used to claim the drop BEFORE attempting the dead-letter, which
 * meant the re-stage fallback — the value going back into the live group — was
 * counted as a discard. Worse, the re-stage hands the same value to the NEXT
 * drain, so a dead-letter write that kept failing met the same job over and over
 * and the tally rose once per cycle: one stuck job, unbounded inflation, on the
 * metric this PR series exists to make trustworthy.
 *
 * These read the real prom-client counters, filtered to each test's own queue
 * name, rather than asserting a call was forwarded — a forwarding assertion would
 * pass with the increment still in the wrong branch.
 */
describe("GroupQueueProcessor drained-sibling dead-letter durability — what the discard tally counts", () => {
  const h = useSpyProcessor();

  /**
   * A body-PRESENT drained sibling whose dead-letter write fails and whose
   * re-stage fallback succeeds — the put-back branch.
   *
   * Driven through `parseDrainedPayload`, the site the review names, NOT through
   * `deadLetterDrainedValue` directly: the tally lives in the CALLER, so calling
   * the inner seam would read zero discards no matter which branch it took and
   * the assertion would be vacuous.
   */
  function failTheDeadLetterWriteOnly(): void {
    h.blobLifecycle.decode.mockRejectedValue(
      new DecodeFailureError({
        message: "unreadable to this worker",
        reason: "body_unreadable",
      }),
    );
    h.blobLifecycle.preserveForDlq.mockResolvedValue("inline");
    h.scripts.writeJobToDlq.mockRejectedValue(new Error("redis down"));
    h.scripts.stage.mockResolvedValue(undefined);
  }

  const drainOneSibling = async () =>
    await (h.processor as any).parseDrainedPayload({
      sibling: makeSibling(),
      groupId: GROUP_ID,
    });

  describe("given a drained job whose dead-letter write fails and is put back into the live group", () => {
    describe("when the discard tally is read", () => {
      /** @scenario a discard tally does not count a job the queue put back */
      it("counts no discard for it, and reports the put-back separately", async () => {
        failTheDeadLetterWriteOnly();
        const queueName = h.queueName;

        await drainOneSibling();

        // The value is back in the live group, so nothing was thrown away.
        // Falsifiability: move recordDrop back above the dead-letter attempt (or
        // fold the put-back branch into it) and this reads 1.
        expect(await discardsCounted(queueName)).toBe(0);
        // Not vacuous: the path really ran and really put the value back — a
        // no-op parseDrainedPayload would fail both of these.
        expect(h.scripts.stage).toHaveBeenCalledTimes(1);
        // And the put-back stays visible as its own event: dropping the count
        // entirely would have traded a wrong signal for no signal.
        expect(await putBacksCounted(queueName)).toBe(1);
        // The reason label matters as much as the count: a put-back mislabelled
        // under some other reason would still pass every assertion above, and
        // gq_jobs_dropped_total's reason is already pinned elsewhere in this
        // directory — this counter's should be too.
        const restagedSamples = (
          await gqDrainedDlqRestagedTotal.get()
        ).values.filter((v) => v.labels.queue_name === queueName);
        expect(restagedSamples).toHaveLength(1);
        expect(restagedSamples[0]!.labels.reason).toBe("body_unreadable");
      });
    });
  });

  describe("given a drained job the queue keeps failing to dead-letter across several cycles", () => {
    describe("when the discard tally is read", () => {
      /** @scenario a repeatedly failing dead-letter write does not inflate the discard tally */
      it("counts no discard however many cycles it takes, and one put-back per cycle", async () => {
        failTheDeadLetterWriteOnly();
        const queueName = h.queueName;

        // Three drain cycles meeting the same still-undead-letterable job — the
        // exact shape of the unbounded inflation, because the put-back hands the
        // value to the next drain, which finds it again.
        for (let cycle = 0; cycle < 3; cycle++) {
          await drainOneSibling();
        }

        // Falsifiability: count the put-back as a discard and this reads 3 —
        // one stuck job having tripled the queue's reported data loss, with
        // nothing bounding it.
        expect(await discardsCounted(queueName)).toBe(0);
        expect(await putBacksCounted(queueName)).toBe(3);
      });
    });
  });

  describe("given a drained job whose dead-letter write and put-back both fail", () => {
    describe("when the discard tally is read", () => {
      /** @scenario a drained job that can be neither dead-lettered nor put back is counted as lost */
      it("counts the discard and records that the body did not survive", async () => {
        // The other drained site (`restageDrainedSiblings`), where one rejecting
        // stage() fails both the re-stage and the fallback that retries it.
        h.blobLifecycle.preserveForDlq.mockResolvedValue("inline");
        h.scripts.writeJobToDlq.mockRejectedValue(new Error("redis down"));
        h.scripts.stage.mockRejectedValue(new Error("still down"));
        const queueName = h.queueName;
        const dropLog = vi.spyOn((h.processor as any).logger, "error");

        await (h.processor as any).restageDrainedSiblings(GROUP_ID, [
          makeSibling(),
        ]);

        // The tally must still move here: skipping these sites wholesale would
        // satisfy the two cases above while hiding a genuine loss.
        expect(await discardsCounted(queueName)).toBe(1);
        expect(await putBacksCounted(queueName)).toBe(0);
        // And it is recorded as a loss, not as a preserved drop — the structured
        // field oncall filters on. Falsifiability: pre-fix this line was written
        // before either attempt was made and asserted `bodyPreserved: true`.
        expect(dropLog).toHaveBeenCalledWith(
          expect.objectContaining({
            stagedJobId: "sib-1",
            reason: "sibling_restage_failed",
            bodyPreserved: false,
          }),
          expect.stringContaining("Failed to re-stage drained sibling"),
        );
      });
    });
  });

  describe("given a drained job whose dead-letter write succeeds", () => {
    describe("when the discard tally is read", () => {
      /** @scenario a successful dead-letter write is counted as a discard and never as a put-back */
      it("counts the discard and does not also count a put-back", async () => {
        h.blobLifecycle.decode.mockRejectedValue(
          new DecodeFailureError({
            message: "unreadable to this worker",
            reason: "body_unreadable",
          }),
        );
        h.blobLifecycle.preserveForDlq.mockResolvedValue("inline");
        h.scripts.writeJobToDlq.mockResolvedValue(undefined);
        const queueName = h.queueName;

        await drainOneSibling();

        // This IS the discard: the write actually succeeded, so recordDrop must
        // fire and the put-back branch must stay silent for it.
        // Falsifiability: remove recordDrainedOutcome's recordDrop call on the
        // dead_lettered branch (or route it into gqDrainedDlqRestagedTotal
        // instead, as the restaged branch does) and this reads 0 while
        // putBacksCounted below reads 1 for a write that never failed.
        expect(await discardsCounted(queueName)).toBe(1);
        expect(await putBacksCounted(queueName)).toBe(0);
      });
    });
  });
});

describe("GroupQueueProcessor drained-sibling dead-letter durability — re-stage paths", () => {
  const h = useSpyProcessor();

  describe("given a drained sibling whose re-stage stage() succeeds", () => {
    describe("when the lease re-renew then fails", () => {
      it("does not dead-letter the already-re-staged sibling (RaiMv double-process guard)", async () => {
        h.scripts.stage.mockResolvedValue(undefined);
        // renewLease() is not supposed to throw (it degrades to the TTL
        // backstop); if it ever does, it sits OUTSIDE the dead-letter fallback
        // catch, so it SURFACES rather than being mistaken for a re-stage failure.
        h.blobLifecycle.renewLease.mockRejectedValue(new Error("lease hiccup"));

        // try/await/catch (not a chained `.catch`) so the rejection is handled
        // synchronously in-band — no unhandled-rejection window to flake on.
        let surfaced = false;
        try {
          await (h.processor as any).restageDrainedSiblings(GROUP_ID, [
            makeSibling(),
          ]);
        } catch {
          surfaced = true;
        }

        // Falsifiability: with renewLease() back INSIDE the try/catch (pre-fix),
        // the lease hiccup is CAUGHT and the sibling is dead-lettered — a live
        // job duplicated into the dead-letter — and restageDrainedSiblings
        // resolves (surfaced stays false). Outside the catch, the throw
        // surfaces and NO dead-letter is written.
        expect(surfaced).toBe(true);
        expect(h.scripts.stage).toHaveBeenCalledTimes(1);
        expect(h.scripts.writeJobToDlq).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a drained sibling whose re-stage stage() fails", () => {
    describe("when restageDrainedSiblings runs", () => {
      it("dead-letters the raw value so the discard is recoverable", async () => {
        h.scripts.stage.mockRejectedValue(new Error("stage failed"));
        h.blobLifecycle.preserveForDlq.mockResolvedValue(undefined);
        h.scripts.writeJobToDlq.mockResolvedValue(undefined);

        await (h.processor as any).restageDrainedSiblings(GROUP_ID, [
          makeSibling(),
        ]);

        expect(h.blobLifecycle.renewLease).not.toHaveBeenCalled();
        expect(h.scripts.writeJobToDlq).toHaveBeenCalledWith(
          expect.objectContaining({
            stagedJobId: "sib-1",
            reason: "sibling_restage_failed",
          }),
        );
      });
    });
  });

  describe("given a drained sibling whose body is genuinely gone (missing_blob)", () => {
    describe("when parseDrainedPayload decodes it", () => {
      it("releases the stale lease and does NOT dead-letter (nothing to preserve)", async () => {
        // Body genuinely gone → decode throws missing_blob. Unlike a body-present
        // drop, there is nothing to dead-letter; the stale lease must be released
        // here because the success-path release no longer covers dropped siblings.
        h.blobLifecycle.decode.mockRejectedValue(
          new DecodeFailureError({
            message: "tiered blob is missing",
            reason: "missing_blob",
          }),
        );
        h.blobLifecycle.releaseLease.mockResolvedValue(undefined);

        const result = await (h.processor as any).parseDrainedPayload({
          sibling: makeSibling(),
          groupId: GROUP_ID,
        });

        expect(result).toBeNull();
        // The stale lease is dropped (blob already gone). Falsifiability: remove
        // the missing_blob `else` release and this lease leaks — release is
        // never called.
        expect(h.blobLifecycle.releaseLease).toHaveBeenCalledWith(
          expect.objectContaining({ values: [RAW_VALUE], groupId: GROUP_ID }),
        );
        // Nothing to preserve: no dead-letter write, no re-stage.
        expect(h.blobLifecycle.preserveForDlq).not.toHaveBeenCalled();
        expect(h.scripts.writeJobToDlq).not.toHaveBeenCalled();
      });
    });
  });
});
