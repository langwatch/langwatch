/**
 * The dispatcher's pace between claims: a claim that filled every free slot is followed at once,
 * one that found fewer jobs than it asked for pauses 25 ms, and a full consumer claims again as a
 * slot frees, with no signal, at most once per 10 ms for a few. Spec: claim-round-trips.feature.
 */
import { createTestLogger } from "@langwatch/test-harness";
import fastq from "fastq";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GroupQueueDispatcher } from "../dispatcher.ts";
import type { ClaimedBatch, DispatchResult } from "../scripts.ts";

const SLOTS = 4;
/** The least time between claims for fewer free slots than a full claim. */
const CLAIM_GAP_MS = 10;

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Lets the dispatcher run every step that needs no timer. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 50; turn += 1) await nextTurn();
}

function job(id: number): DispatchResult {
  return {
    stagedJobId: `job-${id}`,
    groupId: `group-${id}`,
    jobDataJson: "{}",
    originalScore: 0,
    claimToken: `claim-${id}`,
  };
}

/** A dispatcher whose claims return `found(asked)` jobs; its jobs finish at once by default. */
function startDispatcher({
  found,
  work = async () => {},
}: {
  found: (asked: number) => number;
  work?: () => Promise<void>;
}) {
  const asked: number[] = [];
  let made = 0;
  const scripts = {
    getSignalKey: () => "{test}:gq:signal",
    getEarliestReadyScore: async (): Promise<number | null> => null,
    getEarliestCandidateScore: async (): Promise<number | null> => null,
    claimBatch: async ({ maxJobs }: { maxJobs: number }): Promise<ClaimedBatch> => {
      asked.push(maxJobs);
      const claims = Array.from({ length: found(maxJobs) }, () => job((made += 1)));
      return { claims, passedOverUntilMs: null };
    },
  };
  let signalled = false;
  const blockingConnection = {
    // The first wait is answered by a signal; later ones never are, so the loop then rests.
    brpop: (): Promise<unknown> => {
      if (signalled) return new Promise(() => {});
      signalled = true;
      return Promise.resolve(["signal", "1"]);
    },
    del: async (): Promise<number> => 0,
  };
  const processingQueue = fastq.promise<unknown, DispatchResult, void>(work, SLOTS);
  let slots = SLOTS;
  const dispatcher = new GroupQueueDispatcher({
    scripts,
    processingQueue,
    blockingConnection,
    queueName: "{test}",
    globalConcurrency: () => slots,
    activeTtlSec: 300,
    signalTimeoutSec: 5,
    logger: createTestLogger().logger,
    clockMs: () => Date.now(),
  });
  dispatcher.start();
  const grow = (to: number) => {
    slots = to;
    processingQueue.concurrency = to;
    dispatcher.slotsChanged();
  };
  return { asked, grow, dispatcher, stop: () => dispatcher.requestShutdown() };
}

describe("GroupQueueDispatcher pacing", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given a backlog and fewer free slots than a large claim", () => {
    /** @scenario "A claim that fills every free slot is followed at once by the next" */
    it("claims again on its next turn while each claim fills every free slot", async () => {
      let claims = 0;
      const { asked, stop } = startDispatcher({
        found: (want) => ((claims += 1) <= 5 ? want : 0),
      });

      await settle();

      expect(asked.length).toBeGreaterThanOrEqual(6);
      expect(asked.slice(0, 5).every((want) => want > 0 && want <= SLOTS)).toBe(true);
      stop();
    });
  });

  describe("given a queue with fewer ready jobs than free slots", () => {
    /** @scenario "A claim that finds fewer jobs than free slots pauses before the next" */
    it("waits 25 ms before the next claim", async () => {
      const { asked, stop } = startDispatcher({ found: () => 1 });

      await settle();
      expect(asked).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(24);
      await settle();
      expect(asked).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(1);
      await settle();
      expect(asked).toHaveLength(2);
      stop();
    });
  });

  describe("given every slot taken and no queue signal to come", () => {
    /** @scenario "A full consumer claims again as soon as one of its slots frees" */
    it("claims for the freed slot without waiting for a signal", async () => {
      const finish: (() => void)[] = [];
      const { asked, stop } = startDispatcher({
        found: (want) => want,
        work: () => new Promise<void>((resolve) => finish.push(resolve)),
      });

      await settle();
      expect(asked).toEqual([SLOTS]);

      finish.shift()?.();
      await vi.advanceTimersByTimeAsync(CLAIM_GAP_MS);
      await settle();

      expect(asked).toEqual([SLOTS, 1]);
      stop();
    });
  });

  describe("given every slot taken and its jobs finishing one at a time", () => {
    /** @scenario "Slots freed one at a time gather into one claim per gap" */
    it("waits out the 10 ms gap since the last claim and claims for every slot freed meanwhile", async () => {
      const finish: (() => void)[] = [];
      const { asked, stop } = startDispatcher({
        found: (want) => want,
        work: () => new Promise<void>((resolve) => finish.push(resolve)),
      });

      await settle();
      expect(asked).toEqual([SLOTS]);

      finish.shift()?.();
      await settle();
      finish.shift()?.();
      await settle();
      finish.shift()?.();
      await settle();
      expect(asked).toEqual([SLOTS]);

      await vi.advanceTimersByTimeAsync(CLAIM_GAP_MS);
      await settle();

      expect(asked).toEqual([SLOTS, 3]);
      stop();
    });
  });

  describe("given every slot taken when the slot count grows", () => {
    /** @scenario "A full consumer claims again as soon as one of its slots frees" */
    it("claims for the new slots at once", async () => {
      const { asked, grow, stop } = startDispatcher({
        found: (want) => want,
        work: () => new Promise<void>(() => {}),
      });

      await settle();
      grow(SLOTS + 2);
      await vi.advanceTimersByTimeAsync(CLAIM_GAP_MS);
      await settle();

      expect(asked).toEqual([SLOTS, 2]);
      stop();
    });
  });

  describe("given a claim's answer about the queue behind it", () => {
    /** @scenario "A slot waiting on its next claim during a backlog counts as busy" */
    it("reports a backlog after a claim that filled every slot, and none after a short one", async () => {
      const full = startDispatcher({
        found: (want) => want,
        work: () => new Promise<void>(() => {}),
      });
      const short = startDispatcher({ found: () => 1 });

      await settle();

      expect(full.dispatcher.hasBacklog()).toBe(true);
      expect(short.dispatcher.hasBacklog()).toBe(false);
      full.dispatcher.pause();
      expect(full.dispatcher.hasBacklog()).toBe(false);
      full.stop();
      short.stop();
    });
  });
});
