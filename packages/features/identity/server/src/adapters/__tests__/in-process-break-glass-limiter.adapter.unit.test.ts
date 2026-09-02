import { describe, expect, it } from "vitest";
import { InProcessBreakGlassLimiter } from "../in-process-break-glass-limiter.adapter";

describe("the break-glass budget", () => {
  describe("when the parameter is used inside one window", () => {
    it("grants the budget and then stops granting", async () => {
      const now = 1_000;
      const limiter = new InProcessBreakGlassLimiter(() => now, 60_000, 3);

      const verdicts = [
        await limiter.allow(),
        await limiter.allow(),
        await limiter.allow(),
        await limiter.allow(),
      ];

      expect(verdicts).toEqual([true, true, true, false]);
    });
  });

  describe("when the window has passed", () => {
    it("hands the budget back, so an operator is never locked out for long", async () => {
      let now = 1_000;
      const limiter = new InProcessBreakGlassLimiter(() => now, 60_000, 1);

      expect(await limiter.allow()).toBe(true);
      expect(await limiter.allow()).toBe(false);

      now += 60_000;
      expect(await limiter.allow()).toBe(true);
    });
  });
});
