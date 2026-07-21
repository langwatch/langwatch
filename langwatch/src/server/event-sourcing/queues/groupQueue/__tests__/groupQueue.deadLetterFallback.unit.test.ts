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

function makeSibling(): DrainedJob {
  return { stagedJobId: "sib-1", jobDataJson: RAW_VALUE, originalScore: 4242 };
}

describe("GroupQueueProcessor drained-sibling dead-letter durability", () => {
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

  describe("given the dead-letter write fails for a value already out of staging", () => {
    describe("when deadLetterDrainedValue runs", () => {
      /** @scenario a drained value whose dead-letter write fails is re-staged not lost */
      it("re-stages the raw value so the drop stays recoverable instead of vanishing", async () => {
        blobLifecycle.preserveForDlq.mockResolvedValue(undefined);
        scripts.writeJobToDlq.mockRejectedValue(new Error("redis down"));
        scripts.stage.mockResolvedValue(undefined);

        await (processor as any).deadLetterDrainedValue({
          groupId: GROUP_ID,
          stagedJobId: "sib-1",
          jobDataJson: RAW_VALUE,
          reason: "sibling_restage_failed",
          originalScore: 4242,
        });

        // Falsifiability: drop the fallback (call preserveForDlq/writeJobToDlq
        // directly, as before the fix) and stage() is never reached here.
        expect(scripts.stage).toHaveBeenCalledTimes(1);
        expect(scripts.stage).toHaveBeenCalledWith(
          expect.objectContaining({
            stagedJobId: "sib-1",
            groupId: GROUP_ID,
            jobDataJson: RAW_VALUE,
            dispatchAfterMs: 4242,
          }),
        );
      });
    });
  });

  describe("given the dead-letter write succeeds", () => {
    describe("when deadLetterDrainedValue runs", () => {
      it("does not spuriously re-stage a value it just dead-lettered", async () => {
        blobLifecycle.preserveForDlq.mockResolvedValue(undefined);
        scripts.writeJobToDlq.mockResolvedValue(undefined);
        scripts.stage.mockResolvedValue(undefined);

        await (processor as any).deadLetterDrainedValue({
          groupId: GROUP_ID,
          stagedJobId: "sib-1",
          jobDataJson: RAW_VALUE,
          reason: "sibling_restage_failed",
          originalScore: 4242,
        });

        expect(scripts.writeJobToDlq).toHaveBeenCalledTimes(1);
        expect(scripts.stage).not.toHaveBeenCalled();
      });
    });
  });

  describe("given both the dead-letter write and the re-stage fallback fail", () => {
    describe("when deadLetterDrainedValue runs", () => {
      it("does not throw — the value survives in the drop log recordDrop wrote", async () => {
        blobLifecycle.preserveForDlq.mockResolvedValue(undefined);
        scripts.writeJobToDlq.mockRejectedValue(new Error("redis down"));
        scripts.stage.mockRejectedValue(new Error("still down"));

        // Must resolve: the caller awaits this inside its batch loop, so a throw
        // here would abort the remaining siblings.
        await expect(
          (processor as any).deadLetterDrainedValue({
            groupId: GROUP_ID,
            stagedJobId: "sib-1",
            jobDataJson: RAW_VALUE,
            reason: "sibling_restage_failed",
            originalScore: 4242,
          }),
        ).resolves.toBeUndefined();
      });
    });
  });

  describe("given a drained sibling whose re-stage stage() succeeds", () => {
    describe("when the lease re-renew then fails", () => {
      it("does not dead-letter the already-re-staged sibling (RaiMv double-process guard)", async () => {
        scripts.stage.mockResolvedValue(undefined);
        // renewLease() is not supposed to throw (it degrades to the TTL
        // backstop); if it ever does, it sits OUTSIDE the dead-letter fallback
        // catch, so it SURFACES rather than being mistaken for a re-stage failure.
        blobLifecycle.renewLease.mockRejectedValue(new Error("lease hiccup"));

        // try/await/catch (not a chained `.catch`) so the rejection is handled
        // synchronously in-band — no unhandled-rejection window to flake on.
        let surfaced = false;
        try {
          await (processor as any).restageDrainedSiblings(GROUP_ID, [
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
        expect(scripts.stage).toHaveBeenCalledTimes(1);
        expect(scripts.writeJobToDlq).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a drained sibling whose re-stage stage() fails", () => {
    describe("when restageDrainedSiblings runs", () => {
      it("dead-letters the raw value so the discard is recoverable", async () => {
        scripts.stage.mockRejectedValue(new Error("stage failed"));
        blobLifecycle.preserveForDlq.mockResolvedValue(undefined);
        scripts.writeJobToDlq.mockResolvedValue(undefined);

        await (processor as any).restageDrainedSiblings(GROUP_ID, [
          makeSibling(),
        ]);

        expect(blobLifecycle.renewLease).not.toHaveBeenCalled();
        expect(scripts.writeJobToDlq).toHaveBeenCalledWith(
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
        blobLifecycle.decode.mockRejectedValue(
          new DecodeFailureError({
            message: "tiered blob is missing",
            reason: "missing_blob",
          }),
        );
        blobLifecycle.releaseLease.mockResolvedValue(undefined);

        const result = await (processor as any).parseDrainedPayload({
          sibling: makeSibling(),
          groupId: GROUP_ID,
        });

        expect(result).toBeNull();
        // The stale lease is dropped (blob already gone). Falsifiability: remove
        // the missing_blob `else` release and this lease leaks — release is
        // never called.
        expect(blobLifecycle.releaseLease).toHaveBeenCalledWith(
          expect.objectContaining({ values: [RAW_VALUE], groupId: GROUP_ID }),
        );
        // Nothing to preserve: no dead-letter write, no re-stage.
        expect(blobLifecycle.preserveForDlq).not.toHaveBeenCalled();
        expect(scripts.writeJobToDlq).not.toHaveBeenCalled();
      });
    });
  });
});
