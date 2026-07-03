/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockInit, mockStartSessionRecording } = vi.hoisted(() => ({
  mockInit: vi.fn(),
  mockStartSessionRecording: vi.fn(),
}));

vi.mock("posthog-js", () => ({
  default: {
    init: mockInit,
    startSessionRecording: mockStartSessionRecording,
  },
}));

vi.mock("../usePublicEnv", () => ({
  usePublicEnv: () => ({
    data: {
      POSTHOG_KEY: "test-key",
      POSTHOG_HOST: "https://eu.i.posthog.com",
      NODE_ENV: "test",
    },
  }),
}));

import { usePostHog } from "../usePostHog";

describe("usePostHog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("initializes with recording disabled at init time", () => {
    renderHook(() => usePostHog());

    expect(mockInit).toHaveBeenCalledWith(
      "test-key",
      expect.objectContaining({
        disable_session_recording: true,
        session_recording: { recordCrossOriginIframes: true },
      }),
    );
  });

  it("does not start session recording before init's loaded callback fires", () => {
    renderHook(() => usePostHog());

    expect(mockStartSessionRecording).not.toHaveBeenCalled();
  });

  describe("when init's loaded callback fires", () => {
    describe("when requestIdleCallback is available", () => {
      it("defers startSessionRecording to the idle callback", () => {
        let idleCallback: (() => void) | undefined;
        vi.stubGlobal(
          "requestIdleCallback",
          vi.fn((cb: () => void) => {
            idleCallback = cb;
            return 1;
          }),
        );

        renderHook(() => usePostHog());

        const { loaded } = mockInit.mock.calls[0]![1] as {
          loaded: (posthog: unknown) => void;
        };
        loaded({ debug: vi.fn() });

        expect(mockStartSessionRecording).not.toHaveBeenCalled();

        idleCallback?.();

        expect(mockStartSessionRecording).toHaveBeenCalledTimes(1);
      });
    });

    describe("when requestIdleCallback is unavailable (Safari)", () => {
      it("defers startSessionRecording until window 'load' fires", () => {
        vi.stubGlobal("requestIdleCallback", undefined);
        vi.useFakeTimers();

        renderHook(() => usePostHog());

        const { loaded } = mockInit.mock.calls[0]![1] as {
          loaded: (posthog: unknown) => void;
        };
        loaded({ debug: vi.fn() });

        expect(mockStartSessionRecording).not.toHaveBeenCalled();

        window.dispatchEvent(new Event("load"));
        vi.runAllTimers();

        expect(mockStartSessionRecording).toHaveBeenCalledTimes(1);

        vi.useRealTimers();
      });
    });
  });
});
