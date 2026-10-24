/** The dispatcher's signal list: one wake clears it once, at the end of the cycle it ran. */
import { createTestLogger } from "@langwatch/test-harness";
import fastq from "fastq";
import { describe, expect, it, vi } from "vitest";

import { GroupQueueDispatcher } from "../dispatcher.ts";
import type { DispatchResult } from "../scripts.ts";

const SIGNAL_KEY = "{test}:gq:signal";
const waitOptions = { timeout: 2_000, interval: 5 };

function startDispatcher() {
  const calls: string[] = [];
  const waiting: (() => void)[] = [];
  const scripts = {
    getSignalKey: () => SIGNAL_KEY,
    getEarliestReadyScore: async (): Promise<number | null> => null,
    getEarliestCandidateScore: async (): Promise<number | null> => null,
    dispatchBatch: async (): Promise<DispatchResult[]> => {
      calls.push("dispatch");
      return [];
    },
  };
  const blockingConnection = {
    brpop: (key: string): Promise<unknown> => {
      calls.push(`brpop ${key}`);
      return new Promise((resolve) => waiting.push(() => resolve([key, "1"])));
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
    logger: createTestLogger().logger,
  });
  dispatcher.start();
  const signal = (): boolean => {
    const wake = waiting.shift();
    wake?.();
    return wake !== undefined;
  };
  return { dispatcher, calls, signal };
}

describe("GroupQueueDispatcher signal list", () => {
  describe("given the dispatcher wakes on a signal", () => {
    it("dispatches, then clears the signal list once before waiting again", async () => {
      const { dispatcher, calls, signal } = startDispatcher();

      await vi.waitFor(() => expect(signal()).toBe(true), waitOptions);
      await vi.waitFor(
        () => expect(calls.filter((call) => call.startsWith("brpop"))).toHaveLength(2),
        waitOptions,
      );

      expect(calls).toEqual([
        `brpop ${SIGNAL_KEY}`,
        "dispatch",
        `del ${SIGNAL_KEY}`,
        `brpop ${SIGNAL_KEY}`,
      ]);

      dispatcher.requestShutdown();
      signal();
      await dispatcher.waitUntilStopped();
    });
  });
});
