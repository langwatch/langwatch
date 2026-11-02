/** The dispatcher meets a settling group's window on time, and waits as before without one. */
import { createTestLogger } from "@langwatch/test-harness";
import { nowInstant } from "@langwatch/time";
import fastq from "fastq";
import { describe, expect, it, vi } from "vitest";

import { GroupQueueDispatcher } from "../dispatcher.ts";
import type { ClaimedBatch, DispatchResult } from "../scripts.ts";

const SIGNAL_KEY = "{test}:gq:signal";
const waitOptions = { timeout: 2_000, interval: 5 };

/** The first peek finds a group due in 20 ms; later peeks find nothing, so the loop then blocks. */
function startDispatcher({ settleWindowMs }: { settleWindowMs: number }) {
  const calls: string[] = [];
  const waiting: (() => void)[] = [];
  let peeks = 0;
  const scripts = {
    getSignalKey: () => SIGNAL_KEY,
    getEarliestReadyScore: async (): Promise<number | null> =>
      peeks++ === 0 ? nowInstant().epochMilliseconds + 20 : null,
    getEarliestCandidateScore: async (): Promise<number | null> => null,
    claimBatch: async (): Promise<ClaimedBatch> => {
      calls.push("dispatch");
      return { claims: [], passedOverUntilMs: null };
    },
  };
  const blockingConnection = {
    brpop: (key: string, timeout: number): Promise<unknown> => {
      calls.push(`brpop ${key} ${timeout}`);
      return new Promise((resolve) => waiting.push(() => resolve(null)));
    },
    del: async (key: string): Promise<number> => {
      calls.push(`del ${key}`);
      return 1;
    },
  };
  const dispatcher = new GroupQueueDispatcher({
    scripts,
    processingQueue: fastq.promise<unknown, DispatchResult, void>(async () => {}, 10),
    blockingConnection,
    queueName: "{test}",
    globalConcurrency: 10,
    activeTtlSec: 300,
    signalTimeoutSec: 5,
    settleWindowMs,
    logger: createTestLogger().logger,
  });
  dispatcher.start();
  const stop = async () => {
    dispatcher.requestShutdown();
    for (const wake of waiting.splice(0)) wake();
    await dispatcher.waitUntilStopped();
  };
  return { calls, stop };
}

describe("GroupQueueDispatcher settling window", () => {
  describe("given a settling window and a group due sooner than one signal wait", () => {
    /** @scenario "The dispatcher wakes when a settling group's window ends" */
    it("claims once the group is due without blocking on the signal list first", async () => {
      const { calls, stop } = startDispatcher({ settleWindowMs: 10 });

      await vi.waitFor(
        () => expect(calls.filter((call) => call.startsWith("brpop"))).toHaveLength(1),
        waitOptions,
      );

      expect(calls).toEqual(["dispatch", `del ${SIGNAL_KEY}`, `brpop ${SIGNAL_KEY} 5`]);
      await stop();
    });
  });

  describe("given no settling window and a group due sooner than one signal wait", () => {
    /** @scenario "Without a settling window the dispatcher waits on the signal list as before" */
    it("blocks on the signal list for the shortest signal wait", async () => {
      const { calls, stop } = startDispatcher({ settleWindowMs: 0 });

      await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0), waitOptions);

      expect(calls[0]).toBe(`brpop ${SIGNAL_KEY} 0.05`);
      await stop();
    });
  });
});
