import { TriggerAction } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { triggerAggregate } from "../aggregate";

const MATCH_RECORDED = "lw.automation.trigger.match_recorded";

function matchInput() {
  return {
    triggerId: "trigger-1",
    traceId: "trace-1",
    action: TriggerAction.SEND_EMAIL,
    actionClass: "notify" as const,
    traceDebounceMs: 30_000,
    notificationCadence: "immediate" as const,
  };
}

describe("trigger aggregate", () => {
  describe("given the aggregate is declared", () => {
    it("derives the dotted event type already committed to the log", () => {
      expect(triggerAggregate.name).toBe("trigger");
      expect(triggerAggregate.eventTypes).toEqual([MATCH_RECORDED]);
      expect(triggerAggregate.eventType("matchRecorded")).toBe(MATCH_RECORDED);
    });

    it("extracts the aggregate id from any event payload", () => {
      expect(triggerAggregate.id(matchInput())).toBe("trigger-1");
    });
  });

  describe("when recordMatch runs", () => {
    it("emits exactly one matchRecorded event carrying the input unchanged", () => {
      const input = matchInput();
      const events = triggerAggregate.commands.recordMatch.handle(
        triggerAggregate.init(),
        input,
        triggerAggregate.events,
      );

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: MATCH_RECORDED, data: input });
    });
  });

  describe("when apply runs a matchRecorded event", () => {
    it("leaves state unchanged — this aggregate has no accumulator", () => {
      const state = triggerAggregate.init();
      const next = triggerAggregate.apply(state, {
        type: MATCH_RECORDED,
        data: matchInput(),
      });

      expect(next).toEqual(state);
    });
  });

  describe("when apply runs an event type this build does not know", () => {
    it("returns state unchanged rather than throwing", () => {
      const state = triggerAggregate.init();
      const next = triggerAggregate.apply(state, {
        type: "lw.automation.trigger.some_future_event",
        data: {},
      });

      expect(next).toBe(state);
    });
  });
});
