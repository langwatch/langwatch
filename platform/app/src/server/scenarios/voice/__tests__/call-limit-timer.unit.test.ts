import { describe, expect, it, vi } from "vitest";
import { createCallLimitTimer } from "../call-limit-timer";

describe("createCallLimitTimer", () => {
  describe("when the limit elapses", () => {
    it("fires onLimit once and marks the call cut", () => {
      const onLimit = vi.fn();
      let fire: () => void = () => {};
      const setTimer = ((cb: () => void) => {
        fire = cb;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout;

      const timer = createCallLimitTimer({
        maxCallSeconds: 90,
        onLimit,
        setTimer,
        clearTimer: (() => {}) as typeof clearTimeout,
      });

      expect(timer.wasCut()).toBe(false);
      fire();
      fire(); // a duplicate event must not re-fire
      expect(onLimit).toHaveBeenCalledTimes(1);
      expect(timer.wasCut()).toBe(true);
    });

    it("arms the timer for maxCallSeconds in milliseconds", () => {
      const setTimer = vi.fn(
        () => 1 as unknown as ReturnType<typeof setTimeout>,
      ) as unknown as typeof setTimeout;
      createCallLimitTimer({
        maxCallSeconds: 90,
        onLimit: () => {},
        setTimer,
        clearTimer: (() => {}) as typeof clearTimeout,
      });
      expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 90_000);
    });
  });

  describe("when cleared before the limit", () => {
    it("clears the underlying handle and never fires", () => {
      const onLimit = vi.fn();
      const clearTimer = vi.fn() as unknown as typeof clearTimeout;
      const timer = createCallLimitTimer({
        maxCallSeconds: 90,
        onLimit,
        setTimer: (() =>
          7 as unknown as ReturnType<
            typeof setTimeout
          >) as unknown as typeof setTimeout,
        clearTimer,
      });

      timer.clear();

      expect(clearTimer).toHaveBeenCalledWith(7);
      expect(onLimit).not.toHaveBeenCalled();
      expect(timer.wasCut()).toBe(false);
    });
  });
});
