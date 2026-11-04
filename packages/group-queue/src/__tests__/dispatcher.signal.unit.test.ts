/** The dispatcher's signal wait: one wake clears the list once, and a pass-over is waited out. */
import { createTestLogger } from "@langwatch/test-harness";
import { nowInstant } from "@langwatch/time";
import fastq from "fastq";
import { describe, expect, it, vi } from "vitest";

import { GroupQueueDispatcher } from "../dispatcher.ts";
import type { ClaimedBatch, DispatchResult } from "../scripts.ts";

const SIGNAL_KEY = "{test}:gq:signal";
const waitOptions = { timeout: 2_000, interval: 5 };

function startDispatcher() {
  const calls: string[] = [];
  const waiting: (() => void)[] = [];
  const scripts = {
    getSignalKey: () => SIGNAL_KEY,
    getEarliestReadyScore: async (): Promise<number | null> => null,
    getEarliestCandidateScore: async (): Promise<number | null> => null,
    claimBatch: async (): Promise<ClaimedBatch> => {
      calls.push("dispatch");
      return { claims: [], passedOverUntilMs: null };
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

/** A claim passed a group over for this worker until `passOverMs` from now; it is due already. */
function startPassedOver({ nextDueInMs }: { nextDueInMs: number | null }) {
  const timeouts: number[] = [];
  const waiting: (() => void)[] = [];
  const scripts = {
    getSignalKey: () => SIGNAL_KEY,
    getEarliestReadyScore: async ({ afterMs }: { afterMs?: number } = {}) => {
      const nowMs = nowInstant().epochMilliseconds;
      if (afterMs === undefined) return nowMs - 1_000;
      return nextDueInMs === null ? null : nowMs + nextDueInMs;
    },
    getEarliestCandidateScore: async (): Promise<number | null> => null,
    claimBatch: async (): Promise<ClaimedBatch> => ({
      claims: [],
      passedOverUntilMs: nowInstant().epochMilliseconds + 3_000,
    }),
  };
  const dispatcher = new GroupQueueDispatcher({
    scripts,
    processingQueue: fastq.promise<unknown, DispatchResult, void>(async () => {}, 10),
    blockingConnection: {
      brpop: (key: string, timeout: number): Promise<unknown> => {
        timeouts.push(timeout);
        return new Promise((resolve) => waiting.push(() => resolve([key, "1"])));
      },
      del: async (): Promise<number> => 1,
    },
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
  return { dispatcher, timeouts, signal };
}

describe("GroupQueueDispatcher waiting out a pass-over", () => {
  describe.each([
    { nextDueInMs: null, waitSec: 3, waitsFor: "until the pass-over lapses" },
    { nextDueInMs: 1_000, waitSec: 1, waitsFor: "until a group due after the claim comes due" },
  ])(
    "given its last claim passed a due group over for 3s",
    ({ nextDueInMs, waitSec, waitsFor }) => {
      /** @scenario "The worker that handed a job back waits out its pass-over instead of polling" */
      it(`waits ${waitsFor}, not the shortest poll`, async () => {
        const { dispatcher, timeouts, signal } = startPassedOver({ nextDueInMs });

        await vi.waitFor(() => expect(signal()).toBe(true), waitOptions);
        await vi.waitFor(() => expect(timeouts).toHaveLength(2), waitOptions);

        expect(timeouts[0]).toBe(0.05);
        expect(timeouts[1]).toBeGreaterThan(waitSec - 0.2);
        expect(timeouts[1]).toBeLessThanOrEqual(waitSec);

        dispatcher.requestShutdown();
        signal();
        await dispatcher.waitUntilStopped();
      });
    },
  );
});
