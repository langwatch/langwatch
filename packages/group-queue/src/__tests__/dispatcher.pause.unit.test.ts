/**
 * The dispatcher's pause against a claim already in flight: the batch Redis
 * returns is handed over whole, and no further batch is asked for until resume.
 * Spec: packages/eventing/specs/consumer-pause.feature
 */
import { createTestLogger } from "@langwatch/test-harness";
import fastq from "fastq";
import { describe, expect, it, vi } from "vitest";

import { GroupQueueDispatcher } from "../dispatcher.ts";
import type { DispatchResult } from "../scripts.ts";

/** Stands in for the staging Lua: each claim waits until the test answers it. */
class StagingScriptsDouble {
  readonly claims: ((results: DispatchResult[]) => void)[] = [];

  getSignalKey(): string {
    return "{test}:gq:signal";
  }

  async getEarliestReadyScore(): Promise<number | null> {
    return null;
  }

  dispatchBatch(): Promise<DispatchResult[]> {
    return new Promise((resolve) => this.claims.push(resolve));
  }
}

/** Stands in for the blocking connection: BRPOP returns when the test signals. */
class BlockingConnectionDouble {
  private readonly waiting: (() => void)[] = [];

  brpop(): Promise<[string, string]> {
    return new Promise((resolve) => this.waiting.push(() => resolve(["signal", "1"])));
  }

  async del(): Promise<number> {
    return 0;
  }

  /** Wakes the pending BRPOP; false when none is waiting. */
  signal(): boolean {
    const wake = this.waiting.shift();
    wake?.();
    return wake !== undefined;
  }
}

function job(stagedJobId: string): DispatchResult {
  return { stagedJobId, groupId: `group-${stagedJobId}`, jobDataJson: "{}", originalScore: 0 };
}

function startDispatcher() {
  const scripts = new StagingScriptsDouble();
  const connection = new BlockingConnectionDouble();
  const handled: string[] = [];
  const processingQueue = fastq.promise(async (dispatched: DispatchResult) => {
    handled.push(dispatched.stagedJobId);
  }, 10);
  const dispatcher = new GroupQueueDispatcher({
    scripts,
    processingQueue,
    blockingConnection: connection,
    queueName: "{test}",
    globalConcurrency: 10,
    activeTtlSec: 300,
    signalTimeoutSec: 5,
    logger: createTestLogger().logger,
  });
  dispatcher.start();
  return { dispatcher, scripts, connection, handled };
}

const waitOptions = { timeout: 2_000, interval: 5 };

describe("GroupQueueDispatcher pause", () => {
  describe("given the dispatcher has asked Redis for a batch", () => {
    /** @scenario "A claim already issued when the pause lands runs its jobs" */
    it("hands every returned job over and asks for no further batch until resumed", async () => {
      const { dispatcher, scripts, connection, handled } = startDispatcher();
      await vi.waitFor(() => expect(connection.signal()).toBe(true), waitOptions);
      await vi.waitFor(() => expect(scripts.claims).toHaveLength(1), waitOptions);

      dispatcher.pause();
      scripts.claims[0]!([job("first"), job("second")]);

      await vi.waitFor(() => expect(handled).toEqual(["first", "second"]), waitOptions);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(scripts.claims).toHaveLength(1);

      dispatcher.resume();
      await vi.waitFor(() => expect(scripts.claims).toHaveLength(2), waitOptions);
      scripts.claims[1]!([job("third")]);
      await vi.waitFor(() => expect(handled).toEqual(["first", "second", "third"]), waitOptions);

      dispatcher.requestShutdown();
      await dispatcher.waitUntilStopped();
    });
  });
});
