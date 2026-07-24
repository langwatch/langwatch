// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COPY_FEEDBACK_MS, useCopyToClipboard } from "../useCopyToClipboard";

const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useCopyToClipboard", () => {
  describe("when copy is called", () => {
    it("writes the given text to the clipboard", async () => {
      const { result } = renderHook(() => useCopyToClipboard());

      await act(async () => {
        result.current.copy("hello");
        await Promise.resolve();
      });

      expect(writeText).toHaveBeenCalledWith("hello");
    });

    it("flips copied true only after the write resolves", async () => {
      const { result } = renderHook(() => useCopyToClipboard());

      expect(result.current.copied).toBe(false);

      await act(async () => {
        result.current.copy("hello");
        await Promise.resolve();
      });

      expect(result.current.copied).toBe(true);
    });

    it("resets copied to false after the shared feedback duration", async () => {
      const { result } = renderHook(() => useCopyToClipboard());

      await act(async () => {
        result.current.copy("hello");
        await Promise.resolve();
      });
      expect(result.current.copied).toBe(true);

      act(() => {
        vi.advanceTimersByTime(COPY_FEEDBACK_MS);
      });

      expect(result.current.copied).toBe(false);
    });
  });

  describe("when the clipboard write rejects", () => {
    it("keeps copied false (no false confirmation)", async () => {
      writeText.mockRejectedValue(new Error("denied"));
      const { result } = renderHook(() => useCopyToClipboard());

      await act(async () => {
        result.current.copy("hello");
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.copied).toBe(false);
    });
  });

  describe("when copy is called twice in quick succession", () => {
    it("coalesces onto a single re-armed timer", async () => {
      const { result } = renderHook(() => useCopyToClipboard());

      await act(async () => {
        result.current.copy("first");
        await Promise.resolve();
      });

      // Halfway through the first timer, copy again.
      act(() => {
        vi.advanceTimersByTime(COPY_FEEDBACK_MS / 2);
      });
      await act(async () => {
        result.current.copy("second");
        await Promise.resolve();
      });

      // The original timer would have fired by now; because the second copy
      // re-armed it, copied is still true.
      act(() => {
        vi.advanceTimersByTime(COPY_FEEDBACK_MS / 2);
      });
      expect(result.current.copied).toBe(true);

      // A full duration after the second copy, it resets.
      act(() => {
        vi.advanceTimersByTime(COPY_FEEDBACK_MS / 2);
      });
      expect(result.current.copied).toBe(false);
    });
  });

  describe("when the component unmounts with a pending reset", () => {
    it("clears the timer without throwing", async () => {
      const clearSpy = vi.spyOn(globalThis, "clearTimeout");
      const { result, unmount } = renderHook(() => useCopyToClipboard());

      await act(async () => {
        result.current.copy("hello");
        await Promise.resolve();
      });

      unmount();

      expect(clearSpy).toHaveBeenCalled();
      // Advancing past the duration must not throw (no setState after unmount).
      expect(() => {
        vi.advanceTimersByTime(COPY_FEEDBACK_MS);
      }).not.toThrow();
    });
  });
});
