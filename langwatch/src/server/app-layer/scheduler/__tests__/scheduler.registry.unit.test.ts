import { describe, expect, it, vi } from "vitest";
import { SchedulerRegistry } from "../scheduler.registry";
import type { ScheduledJobFire } from "../scheduler.types";

const noopHandler = async (_fire: ScheduledJobFire): Promise<void> => {};

describe("SchedulerRegistry", () => {
  describe("given a targetType registered with a handler", () => {
    describe("when getting that targetType", () => {
      it("returns the registered handler", () => {
        const registry = new SchedulerRegistry();
        const handler = vi.fn(noopHandler);
        registry.register({ targetType: "reportTrigger", handler });
        expect(registry.get("reportTrigger")).toBe(handler);
      });
    });

    describe("when getting an unregistered targetType", () => {
      it("returns undefined", () => {
        const registry = new SchedulerRegistry();
        registry.register({ targetType: "reportTrigger", handler: noopHandler });
        expect(registry.get("weeklyRollup")).toBeUndefined();
      });
    });
  });

  describe("given a targetType already registered", () => {
    describe("when registering the same targetType again", () => {
      it("throws so a double-registration is loud, not a silent shadow", () => {
        const registry = new SchedulerRegistry();
        registry.register({ targetType: "reportTrigger", handler: noopHandler });
        expect(() =>
          registry.register({
            targetType: "reportTrigger",
            handler: noopHandler,
          }),
        ).toThrow(/already registered/);
      });
    });
  });

  describe("given a registry with registrations", () => {
    describe("when cleared", () => {
      it("drops every registration so a fresh App can re-register", () => {
        const registry = new SchedulerRegistry();
        registry.register({ targetType: "reportTrigger", handler: noopHandler });
        registry.clear();
        expect(registry.get("reportTrigger")).toBeUndefined();
      });
    });
  });
});
