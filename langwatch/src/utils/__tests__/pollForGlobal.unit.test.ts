import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pollForGlobal } from "../pollForGlobal";

describe("pollForGlobal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given the value already exists", () => {
    it("calls onFound synchronously without starting a poll", () => {
      const onFound = vi.fn();
      const setInterval = vi.spyOn(global, "setInterval");

      pollForGlobal(() => "value", onFound);

      expect(onFound).toHaveBeenCalledTimes(1);
      expect(onFound).toHaveBeenCalledWith("value");
      expect(setInterval).not.toHaveBeenCalled();
    });

    it("returns a no-op cancel function", () => {
      const cancel = pollForGlobal(() => "value", vi.fn());
      expect(() => cancel()).not.toThrow();
    });
  });

  describe("given the value is not yet available", () => {
    it("does not call onFound before the value appears", () => {
      const onFound = vi.fn();
      let value: string | undefined;

      pollForGlobal(() => value, onFound);
      vi.advanceTimersByTime(200);

      expect(onFound).not.toHaveBeenCalled();
      value = "ready";
    });

    it("calls onFound once the value appears on a later poll", () => {
      const onFound = vi.fn();
      let value: string | undefined;

      pollForGlobal(() => value, onFound, { intervalMs: 100 });

      vi.advanceTimersByTime(100);
      expect(onFound).not.toHaveBeenCalled();

      value = "ready";
      vi.advanceTimersByTime(100);

      expect(onFound).toHaveBeenCalledTimes(1);
      expect(onFound).toHaveBeenCalledWith("ready");
    });

    it("stops polling after onFound fires", () => {
      const onFound = vi.fn();
      const value = "ready";

      pollForGlobal(() => value, onFound, { intervalMs: 50 });
      vi.advanceTimersByTime(50);
      vi.advanceTimersByTime(500);

      expect(onFound).toHaveBeenCalledTimes(1);
    });

    it("gives up after the timeout elapses without calling onFound", () => {
      const onFound = vi.fn();

      pollForGlobal(() => undefined, onFound, {
        intervalMs: 100,
        timeoutMs: 300,
      });

      vi.advanceTimersByTime(1000);

      expect(onFound).not.toHaveBeenCalled();
    });

    describe("when cancelled before the value appears", () => {
      it("never calls onFound even if the value later becomes available", () => {
        const onFound = vi.fn();
        let value: string | undefined;

        const cancel = pollForGlobal(() => value, onFound, {
          intervalMs: 50,
        });
        cancel();

        value = "ready";
        vi.advanceTimersByTime(500);

        expect(onFound).not.toHaveBeenCalled();
      });
    });
  });
});
