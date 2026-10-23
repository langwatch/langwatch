import { describe, expect, it } from "vitest";

import { ConfigurationRefusalThrottle } from "../configuration-refusal-throttle.ts";

describe("ConfigurationRefusalThrottle", () => {
  describe("given an automation refusal already logged", () => {
    it("logs it once inside the window and again after it", () => {
      let at = 0;
      const throttle = ConfigurationRefusalThrottle.create({ now: () => at, windowMs: 1_000 });
      const refusal = { triggerId: "t1", code: "invalid_action_params" };

      expect(throttle.shouldLog(refusal)).toBe(true);
      at = 999;
      expect(throttle.shouldLog(refusal)).toBe(false);
      at = 1_000;
      expect(throttle.shouldLog(refusal)).toBe(true);
    });

    it("tracks each automation and each code on its own", () => {
      const throttle = ConfigurationRefusalThrottle.create({ now: () => 0 });

      expect(throttle.shouldLog({ triggerId: "t1", code: "a" })).toBe(true);
      expect(throttle.shouldLog({ triggerId: "t2", code: "a" })).toBe(true);
      expect(throttle.shouldLog({ triggerId: "t1", code: "b" })).toBe(true);
      expect(throttle.shouldLog({ triggerId: "t1", code: "a" })).toBe(false);
    });
  });

  describe("given more live refusals than it tracks", () => {
    it("evicts only the oldest, so the others stay suppressed", () => {
      let at = 0;
      const throttle = ConfigurationRefusalThrottle.create({ now: () => at });
      for (let i = 0; i < 5_000; i++) {
        at = i;
        throttle.shouldLog({ triggerId: `t${i}`, code: "a" });
      }

      at = 5_000;
      expect(throttle.shouldLog({ triggerId: "new", code: "a" })).toBe(true);
      expect(throttle.shouldLog({ triggerId: "t1", code: "a" })).toBe(false);
      expect(throttle.shouldLog({ triggerId: "t4999", code: "a" })).toBe(false);
      expect(throttle.shouldLog({ triggerId: "t0", code: "a" })).toBe(true);
    });
  });
});
