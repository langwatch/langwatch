// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSimPoll } from "../use-sim-poll.ts";

let visibility: DocumentVisibilityState = "visible";

const setVisibility = ({ state }: { state: DocumentVisibilityState }) => {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useSimPoll", () => {
  describe("given the tab is visible", () => {
    it("asks at once and again every interval", async () => {
      const fetch = vi.fn(async () => "answer");
      const { result } = renderHook(() => useSimPoll({ fetch, everyMs: 1_000 }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.data).toBe("answer");
      expect(fetch).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });
      expect(fetch).toHaveBeenCalledTimes(4);
    });
  });

  describe("when the tab is hidden", () => {
    /** @scenario "A console stops asking while its tab is hidden" */
    it("stops asking, then asks at once and resumes when shown", async () => {
      const fetch = vi.fn(async () => "answer");
      renderHook(() => useSimPoll({ fetch, everyMs: 1_000 }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetch).toHaveBeenCalledTimes(1);

      await act(async () => {
        setVisibility({ state: "hidden" });
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(fetch).toHaveBeenCalledTimes(1);

      await act(async () => {
        setVisibility({ state: "visible" });
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetch).toHaveBeenCalledTimes(2);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(fetch).toHaveBeenCalledTimes(3);
    });
  });

  describe("when a call fails", () => {
    it("keeps the last data and reports the error", async () => {
      const fetch = vi
        .fn<() => Promise<string>>()
        .mockResolvedValueOnce("first")
        .mockRejectedValueOnce(new Error("down"));
      const { result } = renderHook(() => useSimPoll({ fetch, everyMs: 1_000 }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });

      expect(result.current.data).toBe("first");
      expect(result.current.error?.message).toBe("down");
      expect(result.current.refreshing).toBe(false);
    });
  });
});
