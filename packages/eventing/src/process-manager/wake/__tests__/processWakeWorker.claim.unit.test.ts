import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

import {
  LIVENESS_MS,
  PROCESS_NAME,
  type PilotState,
  pilotDefinition,
  pilotEvent,
  pilotRef,
  T0,
} from "../../__tests__/helpers/pilotProcess.fixture.ts";
import type { HandleResult } from "../../processManagerService.ts";
import { ProcessManagerService } from "../../processManagerService.ts";
import { InMemoryProcessStore } from "../../stores/inMemoryProcessStore.ts";
import type { DueWake } from "../../stores/processStore.types.ts";
import { type ProcessWakeHandler, ProcessWakeWorker } from "../processWakeWorker.ts";
import { WAKE_CLAIM_LEASE_MS, WAKE_CLAIM_SAFETY_MARGIN_MS } from "../wakeClaim.ts";

const DUE_AT = T0 + LIVENESS_MS;

/** One store and the real service over it, with the pilot's first turn running. */
async function pilotWorld({ conversations = ["conv_1"] } = {}) {
  const store = InMemoryProcessStore.createForTesting();
  const service = new ProcessManagerService<PilotState>({ definition: pilotDefinition, store });
  for (const [index, processKey] of conversations.entries()) {
    await service.handleEvent({
      envelope: pilotEvent({ processKey, occurredAt: T0 + index }),
      now: T0 + index,
    });
  }
  return { store, service };
}

/** The worker's handler port over the real service, keeping what each wake came back as. */
function recordingHandler(
  service: ProcessManagerService<PilotState>,
  before: (wake: DueWake) => void = () => undefined,
): ProcessWakeHandler & {
  handed: string[];
  wakes: DueWake[];
  outcomes: HandleResult["outcome"][];
} {
  const handed: string[] = [];
  const wakes: DueWake[] = [];
  const outcomes: HandleResult["outcome"][] = [];
  return {
    handed,
    wakes,
    outcomes,
    async handleWake(params) {
      handed.push(params.wake.ref.processKey);
      wakes.push(params.wake);
      before(params.wake);
      const result = await service.handleWake(params);
      outcomes.push(result.outcome);
      return result;
    },
  };
}

function wakeWorker(params: {
  store: InMemoryProcessStore;
  handler: ProcessWakeHandler;
  now: () => number;
  logger?: ReturnType<typeof createTestLogger>["logger"];
}): ProcessWakeWorker {
  return new ProcessWakeWorker({
    store: params.store,
    managers: { [PROCESS_NAME]: params.handler },
    logger: params.logger ?? createTestLogger().logger,
    now: params.now,
  });
}

/** One scan: start begins it, stop waits for it to finish handling its batch. */
async function pollOnce(worker: ProcessWakeWorker): Promise<void> {
  worker.start();
  await worker.stop();
}

describe("ProcessWakeWorker claims", () => {
  describe("given two wake workers polling the same due wake", () => {
    describe("when both poll at the same moment", () => {
      /** @scenario "Racing wake workers handle a due wake once" */
      it("hands the wake to one worker, which commits it once from its due time", async () => {
        const { store, service } = await pilotWorld();
        const first = recordingHandler(service);
        const second = recordingHandler(service);
        const now = () => DUE_AT + 1_000;
        const workers = [
          wakeWorker({ store, handler: first, now }),
          wakeWorker({ store, handler: second, now }),
        ];

        for (const worker of workers) worker.start();
        await Promise.all(workers.map((worker) => worker.stop()));

        expect([...first.handed, ...second.handed]).toEqual(["conv_1"]);
        expect([...first.outcomes, ...second.outcomes]).toEqual(["committed"]);
        const instance = await store.findByRef({ ref: pilotRef });
        expect(instance?.revision).toBe(2);
        expect(instance?.nextWakeAt).toBe(DUE_AT + LIVENESS_MS);
        const messageKeys = (await store.findMessagesByRef({ ref: pilotRef })).map(
          (message) => message.messageKey,
        );
        expect(messageKeys.toSorted()).toEqual(["dispatch:turn_1:1", "dispatch:turn_1:2"]);
      });
    });
  });

  describe("given a worker claimed a due wake and its handling failed", () => {
    describe("when another worker polls long before the claim would have lapsed", () => {
      /** @scenario "A wake whose handling fails is due again on the next poll" */
      it("is handed the wake with the time it was first due, and commits it", async () => {
        const { store, service } = await pilotWorld();
        const claimedAt = DUE_AT + 1_000;
        const failing: ProcessWakeHandler = {
          handleWake: () => Promise.reject(new Error("database unavailable")),
        };
        await pollOnce(wakeWorker({ store, handler: failing, now: () => claimedAt }));

        expect((await store.findByRef({ ref: pilotRef }))?.nextWakeAt).toBe(DUE_AT);
        const next = recordingHandler(service);
        await pollOnce(wakeWorker({ store, handler: next, now: () => claimedAt + 5_000 }));

        expect(next.wakes).toEqual([{ ref: pilotRef, revision: 1, wakeAt: DUE_AT }]);
        expect(next.outcomes).toEqual(["committed"]);
        expect((await store.findByRef({ ref: pilotRef }))?.nextWakeAt).toBe(DUE_AT + LIVENESS_MS);
      });
    });
  });

  describe("given a worker claimed a batch and handling the first wake ate into the claim's safety margin", () => {
    describe("when the worker reaches the rest of the batch", () => {
      /** @scenario "A worker leaves the tail of a batch its claim has run out on" */
      it("releases the rest unhandled, back to the times they were due", async () => {
        const { store, service } = await pilotWorld({ conversations: ["conv_a", "conv_b"] });
        let clock = DUE_AT + 1_000;
        const claimedAt = clock;
        const { logger, lines } = createTestLogger();
        const slow = recordingHandler(service, () => {
          clock += WAKE_CLAIM_LEASE_MS - WAKE_CLAIM_SAFETY_MARGIN_MS;
        });
        const tail = { ...pilotRef, processKey: "conv_b" };
        await pollOnce(wakeWorker({ store, handler: slow, now: () => clock, logger }));

        expect(slow.handed).toEqual(["conv_a"]);
        expect(lines.filter((line) => line.level === 40 && line.unhandled === 1)).toHaveLength(1);
        expect(await store.findByRef({ ref: tail })).toMatchObject({
          revision: 1,
          nextWakeAt: DUE_AT + 1,
        });

        const next = recordingHandler(service);
        await pollOnce(
          wakeWorker({ store, handler: next, now: () => claimedAt + WAKE_CLAIM_LEASE_MS }),
        );

        expect(next.wakes).toContainEqual({ ref: tail, revision: 1, wakeAt: DUE_AT + 1 });
        expect((await store.findByRef({ ref: tail }))?.revision).toBe(2);
      });
    });
  });
});
