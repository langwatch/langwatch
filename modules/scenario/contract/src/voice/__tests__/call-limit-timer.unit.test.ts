import { describe, expect, it, vi } from "vitest";

import { createCallLimitTimer } from "../call-limit-timer.ts";

function realHandle(): ReturnType<typeof setTimeout> {
  const handle = setTimeout(() => {}, 0);
  clearTimeout(handle);
  return handle;
}

describe("createCallLimitTimer", () => {
  describe("given a running call limit timer", () => {
    describe("when the limit elapses", () => {
      it("fires onLimit once and marks the call cut", () => {
        const onLimit = vi.fn();
        const handle = realHandle();
        let fire: () => void = () => {};
        const timer = createCallLimitTimer({
          maxCallSeconds: 90,
          onLimit,
          setTimer: (callback) => {
            fire = callback;
            return handle;
          },
          clearTimer: () => {},
        });

        expect(timer.wasCut()).toBe(false);
        fire();
        fire(); // a duplicate event must not re-fire
        expect(onLimit).toHaveBeenCalledTimes(1);
        expect(timer.wasCut()).toBe(true);
      });

      it("arms the timer for maxCallSeconds in milliseconds", () => {
        const handle = realHandle();
        const setTimer = vi.fn((_callback: () => void, _ms: number) => handle);
        createCallLimitTimer({
          maxCallSeconds: 90,
          onLimit: () => {},
          setTimer,
          clearTimer: () => {},
        });
        expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 90_000);
      });
    });

    describe("when cleared before the limit", () => {
      it("clears the underlying handle and never fires", () => {
        const onLimit = vi.fn();
        const handle = realHandle();
        const clearTimer = vi.fn((_handle: ReturnType<typeof setTimeout>) => {});
        const timer = createCallLimitTimer({
          maxCallSeconds: 90,
          onLimit,
          setTimer: () => handle,
          clearTimer,
        });

        timer.clear();

        expect(clearTimer).toHaveBeenCalledWith(handle);
        expect(onLimit).not.toHaveBeenCalled();
        expect(timer.wasCut()).toBe(false);
      });
    });
  });
});
