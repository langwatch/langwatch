import { describe, expect, it } from "vitest";
import { TriggerAction } from "@prisma/client";
import { triggerAggregate } from "../aggregate";

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
    it("derives its name and one matchRecorded event type", () => {
      expect(triggerAggregate.name).toBe("trigger");
      expect(triggerAggregate.eventTypes).toEqual(["trigger/matchRecorded"]);
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
      expect(events[0]).toEqual({ type: "trigger/matchRecorded", data: input });
    });
  });

  describe("when apply runs a matchRecorded event", () => {
    it("leaves state unchanged — this aggregate has no accumulator", () => {
      const state = triggerAggregate.init();
      const next = triggerAggregate.apply(state, {
        type: "trigger/matchRecorded",
        data: matchInput(),
      });

      expect(next).toEqual(state);
    });
  });

  describe("when apply runs an event type this build does not know", () => {
    it("returns state unchanged rather than throwing", () => {
      const state = triggerAggregate.init();
      const next = triggerAggregate.apply(state, {
        type: "trigger/someFutureEvent",
        data: {},
      });

      expect(next).toBe(state);
    });
  });
});
