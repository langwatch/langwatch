/**
 * What a run in flight does when it is cancelled, redelivered, stalled, or its
 * page fails, driven through the same mounted topology.
 *
 * Needs no datastore: the process store is in memory and the domain port is a
 * fake, which is what lets the loop itself be asserted rather than the
 * behaviour of a classifier.
 *
 * @see ../../pipeline.ts
 * @see ../../../../../../../specs/instant-evals/instant-eval-pipeline.feature
 */

import { describe, expect, it, vi } from "vitest";

import { INSTANT_EVAL_EVENT_TYPES } from "../../schemas/constants";
import { INSTANT_EVAL_STALL_THRESHOLD_MS } from "../instantEvalProcess.types";
import {
  harness,
  key,
  makeEvent,
  pageJudged,
  planned,
  REF,
  RUN_ID,
  requested,
  toEnvelope,
} from "./instantEvalProcessFlowHarness";

describe("given a run in progress", () => {
  describe("when the same page is delivered again", () => {
    /** @scenario "A redelivered page writes the same judgements rather than doubling them" */
    it("leaves the run's progress where it was", async () => {
      const { manager, store } = harness();

      await manager.handleEvent({
        envelope: toEnvelope(requested),
        now: 10_000,
      });
      await manager.handleEvent({
        envelope: toEnvelope(planned()),
        now: 11_000,
      });
      const event = pageJudged({ page: 1 });
      await manager.handleEvent({ envelope: toEnvelope(event), now: 12_000 });
      const again = await manager.handleEvent({
        envelope: toEnvelope(event),
        now: 12_500,
      });

      expect(again.outcome).toBe("duplicateEvent");
      const pages = (await store.findMessagesByRef({ ref: REF })).filter(
        (message) => message.messageKey === key(`page:${RUN_ID}:2`),
      );
      expect(pages).toHaveLength(1);
    });
  });

  describe("when a cancellation lands", () => {
    /** @scenario "A cancelled run stops between pages" */
    it("does not judge another page and finishes as cancelled", async () => {
      const { manager, dispatcher, store, commands, port } = harness();

      await manager.handleEvent({
        envelope: toEnvelope(requested),
        now: 10_000,
      });
      await manager.handleEvent({
        envelope: toEnvelope(planned()),
        now: 11_000,
      });
      await dispatcher.runOnce({ now: 11_001 });
      const judgedPages = (port.judgePage as ReturnType<typeof vi.fn>).mock
        .calls.length;

      await manager.handleEvent({
        envelope: toEnvelope(
          makeEvent({
            type: INSTANT_EVAL_EVENT_TYPES.CANCEL_REQUESTED,
            occurredAt: 12_000,
            data: { runId: RUN_ID, requestedByUserId: null },
          }),
        ),
        now: 12_000,
      });
      await manager.handleEvent({
        envelope: toEnvelope(pageJudged({ page: 1 })),
        now: 12_500,
      });
      await dispatcher.runOnce({ now: 12_501 });

      const pages = (await store.findMessagesByRef({ ref: REF })).filter(
        (message) => message.messageKey === key(`page:${RUN_ID}:2`),
      );
      expect(pages).toHaveLength(0);
      expect(
        (port.judgePage as ReturnType<typeof vi.fn>).mock.calls.length,
      ).toBe(judgedPages);
      expect(commands.calls.recordFinished).toEqual([
        expect.objectContaining({ outcome: "cancelled" }),
      ]);
    });
  });

  describe("when its pages stop arriving", () => {
    /** @scenario "A run whose pages stop arriving is failed by the watchdog" */
    it("is failed by the wake with the stalled reason", async () => {
      const { manager, dispatcher, store, commands } = harness();

      await manager.handleEvent({
        envelope: toEnvelope(requested),
        now: 10_000,
      });
      await manager.handleEvent({
        envelope: toEnvelope(planned()),
        now: 11_000,
      });

      const [wake] = await store.findDueWakes({
        now: Number.MAX_SAFE_INTEGER,
        limit: 10,
      });
      expect(wake).toBeDefined();
      await manager.handleWake({
        wake: wake!,
        now: 11_000 + INSTANT_EVAL_STALL_THRESHOLD_MS + 1,
      });
      await dispatcher.runOnce({
        now: 11_000 + INSTANT_EVAL_STALL_THRESHOLD_MS + 2,
      });

      expect(commands.calls.recordFinished).toEqual([
        expect.objectContaining({
          outcome: "failed",
          errorCode: "instant_eval_stalled",
        }),
      ]);
    });
  });
});

describe("given a page whose judging fails", () => {
  describe("when attempts remain", () => {
    /** @scenario "A page that mostly failed is thrown so the queue delivers it again" */
    it("hands the message back to the outbox", async () => {
      const { manager, dispatcher, store } = harness({
        judgePage: vi.fn(async () => {
          throw new Error("page lost most of its judgements");
        }),
      });

      await manager.handleEvent({
        envelope: toEnvelope(requested),
        now: 10_000,
      });
      await manager.handleEvent({
        envelope: toEnvelope(planned()),
        now: 11_000,
      });
      await dispatcher.runOnce({ now: 11_001 });

      const pageMessage = (await store.findMessagesByRef({ ref: REF })).find(
        (message) => message.messageKey === key(`page:${RUN_ID}:1`),
      );
      expect(pageMessage?.status).not.toBe("dispatched");
    });
  });
});
