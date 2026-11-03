/**
 * The dispatcher's pace between claims: a claim that filled every free slot is followed at once,
 * one that found fewer jobs than it asked for pauses 25 ms. Spec: specs/claim-round-trips.feature.
 */
import { createTestLogger } from "@langwatch/test-harness";
import fastq from "fastq";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GroupQueueDispatcher } from "../dispatcher.ts";
import type { ClaimedBatch, DispatchResult } from "../scripts.ts";

const SLOTS = 4;

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

/** A dispatcher whose claims return `found(asked)` jobs; its jobs finish at once. */
function startDispatcher({ found }: { found: (asked: number) => number }) {
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
  const dispatcher = new GroupQueueDispatcher({
    scripts,
    processingQueue: fastq.promise<unknown, DispatchResult, void>(async () => {}, SLOTS),
    blockingConnection,
    queueName: "{test}",
    globalConcurrency: SLOTS,
    activeTtlSec: 300,
    signalTimeoutSec: 5,
    logger: createTestLogger().logger,
  });
  dispatcher.start();
  return { asked, stop: () => dispatcher.requestShutdown() };
}

describe("GroupQueueDispatcher pacing", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
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
});
