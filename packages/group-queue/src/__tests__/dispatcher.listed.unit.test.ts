/**
 * A dispatcher that runs only listed groups beside the queue's own: it polls, and never takes
 * or clears the shared wake-up signal the other dispatcher sleeps on.
 * Spec: specs/upgrade/background-steps.feature.
 */
import { createTestLogger } from "@langwatch/test-harness";
import fastq from "fastq";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { GroupQueueDispatcher } from "../dispatcher.ts";
import type { DispatchResult } from "../scripts.ts";

describe("GroupQueueDispatcher with an allow-list", () => {
  describe("given it runs beside the queue's own dispatcher", () => {
    /** @scenario "The upgrade-step consumer leaves the queue's wake-up signal to the main consumer" */
    it("claims from each open list in turn, polling without taking or clearing the signal", async () => {
      const dispatchBatch = vi.fn(async (): Promise<DispatchResult[]> => []);
      const brpop = vi.fn(async () => null);
      const del = vi.fn(async () => 0);
      const dispatcher = new GroupQueueDispatcher({
        scripts: {
          getSignalKey: () => "{test}:gq:signal",
          getEarliestReadyScore: async () => null,
          getEarliestCandidateScore: async () => null,
          dispatchBatch,
        },
        processingQueue: fastq.promise(async () => {}, 10),
        blockingConnection: { brpop, del },
        queueName: "{test}",
        globalConcurrency: 10,
        activeTtlSec: 300,
        signalTimeoutSec: 0.01,
        logger: createTestLogger().logger,
        listedGroupsKeys: async () => ["{test}:gq:listed:a", "{test}:gq:listed:b"],
      });

      dispatcher.start();
      await vi.waitFor(() => expect(dispatchBatch.mock.calls.length).toBeGreaterThanOrEqual(3), {
        timeout: 2_000,
        interval: 5,
      });
      dispatcher.requestShutdown();
      await dispatcher.waitUntilStopped();

      expect(brpop).not.toHaveBeenCalled();
      expect(del).not.toHaveBeenCalled();
      for (const list of ["a", "b"]) {
        expect(dispatchBatch).toHaveBeenCalledWith(
          expect.objectContaining({ allowedGroupsKey: `{test}:gq:listed:${list}:candidates` }),
        );
      }
    });
  });

  describe("given every slot is busy with its own job", () => {
    /** @scenario "The upgrade-step consumer claims again as soon as one of its own jobs finishes" */
    it("claims its next job when that job finishes, not at its next poll", async () => {
      let claimed = 0;
      const dispatchBatch = vi.fn(async (): Promise<DispatchResult[]> => {
        if (claimed >= 3) return [];
        claimed += 1;
        return [
          {
            stagedJobId: `job-${claimed}`,
            groupId: `tenant/listed/${claimed}`,
            jobDataJson: "{}",
            originalScore: 0,
            claimToken: `token-${claimed}`,
          },
        ];
      });
      const ran: string[] = [];
      const dispatcher = new GroupQueueDispatcher({
        scripts: {
          getSignalKey: () => "{test}:gq:signal",
          getEarliestReadyScore: async () => null,
          getEarliestCandidateScore: async () => null,
          dispatchBatch,
        },
        processingQueue: fastq.promise(async (job: DispatchResult) => {
          await new Promise((resolve) => setTimeout(resolve, 60));
          ran.push(job.stagedJobId);
        }, 1),
        blockingConnection: { brpop: vi.fn(async () => null), del: vi.fn(async () => 0) },
        queueName: "{test}",
        globalConcurrency: 1,
        activeTtlSec: 300,
        // A one-second poll: three 60 ms jobs take about three seconds if each waits for one.
        signalTimeoutSec: 1,
        logger: createTestLogger().logger,
        listedGroupsKeys: async () => ["{test}:gq:listed:a"],
      });

      dispatcher.start();
      await vi.waitFor(() => expect(ran).toEqual(["job-1", "job-2", "job-3"]), {
        timeout: 2_500,
        interval: 10,
      });
      dispatcher.requestShutdown();
      await dispatcher.waitUntilStopped();
    });
  });

  describe("given a candidate passed over while its group ran", () => {
    /** @scenario "A listed run's group gets its next job about a second after a job sent outside the run" */
    it("claims just after the candidate comes due, even when its timer fires on that millisecond", async () => {
      // Fake timers fire on the exact millisecond, as Linux timers do; macOS ones run late.
      vi.useFakeTimers({ now: 1_000_000 });
      onTestFinished(() => void vi.useRealTimers());
      const dueAtMs = 1_006_000;
      const claimedAt: number[] = [];
      const dispatcher = new GroupQueueDispatcher({
        scripts: {
          getSignalKey: () => "{test}:gq:signal",
          getEarliestReadyScore: async () => null,
          getEarliestCandidateScore: async ({ afterMs }) => (afterMs < dueAtMs ? dueAtMs : null),
          dispatchBatch: async ({ nowMs }) => {
            claimedAt.push(nowMs);
            return [];
          },
        },
        processingQueue: fastq.promise(async () => {}, 1),
        blockingConnection: { brpop: vi.fn(async () => null), del: vi.fn(async () => 0) },
        queueName: "{test}",
        globalConcurrency: 1,
        activeTtlSec: 300,
        signalTimeoutSec: 5,
        logger: createTestLogger().logger,
        listedGroupsKeys: async () => ["{test}:gq:listed:a"],
      });

      dispatcher.start();
      await vi.advanceTimersByTimeAsync(6_100);
      dispatcher.requestShutdown();
      await vi.advanceTimersByTimeAsync(100);

      expect(claimedAt.find((at) => at > dueAtMs)).toBeLessThan(dueAtMs + 50);
    });
  });

  describe("given a candidate that comes due while a claim is running", () => {
    /** @scenario "A listed run's group gets its next job about a second after a job sent outside the run" */
    it("claims it at the next short poll, not after the idle wait", async () => {
      vi.useFakeTimers({ now: 1_000_000 });
      onTestFinished(() => void vi.useRealTimers());
      // The first claim follows the first idle wait, at 1_005_000.
      const dueAtMs = 1_005_010;
      const claimedAt: number[] = [];
      const dispatcher = new GroupQueueDispatcher({
        scripts: {
          getSignalKey: () => "{test}:gq:signal",
          getEarliestReadyScore: async () => null,
          getEarliestCandidateScore: async ({ afterMs }) =>
            claimedAt.some((at) => at > dueAtMs) || afterMs >= dueAtMs ? null : dueAtMs,
          dispatchBatch: async ({ nowMs }) => {
            claimedAt.push(nowMs);
            // The claim takes 20 ms, so the candidate comes due while it runs.
            if (claimedAt.length === 1) vi.setSystemTime(nowMs + 20);
            return [];
          },
        },
        processingQueue: fastq.promise(async () => {}, 1),
        blockingConnection: { brpop: vi.fn(async () => null), del: vi.fn(async () => 0) },
        queueName: "{test}",
        globalConcurrency: 1,
        activeTtlSec: 300,
        signalTimeoutSec: 5,
        logger: createTestLogger().logger,
        listedGroupsKeys: async () => ["{test}:gq:listed:a"],
      });

      dispatcher.start();
      await vi.advanceTimersByTimeAsync(6_000);
      dispatcher.requestShutdown();
      await vi.advanceTimersByTimeAsync(100);

      expect(claimedAt.find((at) => at > dueAtMs)).toBeLessThan(dueAtMs + 100);
    });
  });
});
