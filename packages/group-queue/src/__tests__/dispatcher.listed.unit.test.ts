/**
 * A dispatcher that runs only listed groups beside the queue's own: it polls, and never takes
 * or clears the shared wake-up signal the other dispatcher sleeps on.
 * Spec: specs/upgrade/background-steps.feature.
 */
import { createTestLogger } from "@langwatch/test-harness";
import fastq from "fastq";
import { describe, expect, it, vi } from "vitest";

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
});
