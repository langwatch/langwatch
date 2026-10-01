/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockInit, mockStartSessionRecording, mockDebug } = vi.hoisted(() => ({
  mockInit: vi.fn(),
  mockStartSessionRecording: vi.fn(),
  mockDebug: vi.fn(),
}));

vi.mock("posthog-js", () => ({
  default: {
    init: mockInit,
    startSessionRecording: mockStartSessionRecording,
    debug: mockDebug,
  },
}));

import { type PostHogPublicConfig, usePostHog } from "../posthog.ts";

let publicEnvData: PostHogPublicConfig | undefined = {
  mode: "test",
  telemetry: {
    posthog: { key: "test-key", host: "https://eu.i.posthog.com" },
  },
};

function fireLoadedCallback() {
  const { loaded } = mockInit.mock.calls[0]![1] as {
    loaded: (posthog: unknown) => void;
  };
  loaded({ debug: mockDebug });
}

describe("usePostHog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    publicEnvData = {
      mode: "test",
      telemetry: {
        posthog: { key: "test-key", host: "https://eu.i.posthog.com" },
      },
    };
    delete (window as { posthog?: unknown }).posthog;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("when publicEnv has not loaded yet", () => {
    it("does not call posthog.init", () => {
      publicEnvData = undefined;

      renderHook(() => usePostHog(publicEnvData));

      expect(mockInit).not.toHaveBeenCalled();
    });

    it("returns undefined", () => {
      publicEnvData = undefined;

      const { result } = renderHook(() => usePostHog(publicEnvData));

      expect(result.current).toBeUndefined();
    });
  });

  describe("when publicEnv has loaded but there is no POSTHOG_KEY", () => {
    it("does not call posthog.init", () => {
      publicEnvData = {
        mode: "test",
        telemetry: { posthog: void 0 },
      };

      renderHook(() => usePostHog(publicEnvData));

      expect(mockInit).not.toHaveBeenCalled();
    });

    it("returns undefined", () => {
      publicEnvData = {
        mode: "test",
        telemetry: { posthog: void 0 },
      };

      const { result } = renderHook(() => usePostHog(publicEnvData));

      expect(result.current).toBeUndefined();
    });
  });

  describe("when a POSTHOG_KEY is present", () => {
    it("calls posthog.init with the key", () => {
      renderHook(() => usePostHog(publicEnvData));

      expect(mockInit).toHaveBeenCalledWith("test-key", expect.any(Object));
    });

    it("returns the posthog client", () => {
      const { result } = renderHook(() => usePostHog(publicEnvData));

      expect(result.current).toBeDefined();
    });

    it("initializes with recording disabled at init time", () => {
      renderHook(() => usePostHog(publicEnvData));

      expect(mockInit).toHaveBeenCalledWith(
        "test-key",
        expect.objectContaining({
          disable_session_recording: true,
          session_recording: { recordCrossOriginIframes: true },
        }),
      );
    });

    it("keeps core capture options eager and unchanged", () => {
      renderHook(() => usePostHog(publicEnvData));

      expect(mockInit).toHaveBeenCalledWith(
        "test-key",
        expect.objectContaining({
          autocapture: true,
          capture_pageview: "history_change",
          capture_exceptions: true,
          person_profiles: "always",
        }),
      );
    });

    it("does not start session recording before init's loaded callback fires", () => {
      renderHook(() => usePostHog(publicEnvData));

      expect(mockStartSessionRecording).not.toHaveBeenCalled();
    });
  });

  describe("given a POSTHOG_HOST is provided", () => {
    it("uses it as api_host", () => {
      publicEnvData = {
        mode: "test",
        telemetry: {
          posthog: { key: "test-key", host: "https://self-hosted.example.com" },
        },
      };

      renderHook(() => usePostHog(publicEnvData));

      expect(mockInit).toHaveBeenCalledWith(
        "test-key",
        expect.objectContaining({
          api_host: "https://self-hosted.example.com",
        }),
      );
    });
  });

  describe("given no POSTHOG_HOST is provided", () => {
    it("defaults api_host to the EU PostHog endpoint", () => {
      publicEnvData = {
        mode: "test",
        telemetry: { posthog: { key: "test-key" } },
      };

      renderHook(() => usePostHog(publicEnvData));

      expect(mockInit).toHaveBeenCalledWith(
        "test-key",
        expect.objectContaining({
          api_host: "https://eu.i.posthog.com",
        }),
      );
    });
  });

  describe("when init's loaded callback fires", () => {
    it("exposes the client on window.posthog", () => {
      renderHook(() => usePostHog(publicEnvData));

      fireLoadedCallback();

      expect((window as { posthog?: unknown }).posthog).toBeDefined();
    });

    describe("given NODE_ENV is development", () => {
      it("enables posthog debug logging", () => {
        publicEnvData = {
          mode: "development",
          telemetry: { posthog: { key: "test-key" } },
        };

        renderHook(() => usePostHog(publicEnvData));
        fireLoadedCallback();

        expect(mockDebug).toHaveBeenCalledTimes(1);
      });
    });

    describe("given NODE_ENV is not development", () => {
      it("does not enable posthog debug logging", () => {
        publicEnvData = {
          mode: "production",
          telemetry: { posthog: { key: "test-key" } },
        };

        renderHook(() => usePostHog(publicEnvData));
        fireLoadedCallback();

        expect(mockDebug).not.toHaveBeenCalled();
      });
    });

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

        renderHook(() => usePostHog(publicEnvData));
        fireLoadedCallback();

        expect(mockStartSessionRecording).not.toHaveBeenCalled();

        idleCallback?.();

        expect(mockStartSessionRecording).toHaveBeenCalledTimes(1);
      });

      it("passes a timeout so the callback can't wait forever", () => {
        const requestIdleCallback = vi.fn(() => 1);
        vi.stubGlobal("requestIdleCallback", requestIdleCallback);

        renderHook(() => usePostHog(publicEnvData));
        fireLoadedCallback();

        expect(requestIdleCallback).toHaveBeenCalledWith(
          expect.any(Function),
          expect.objectContaining({ timeout: expect.any(Number) }),
        );
      });

      describe("when the hook unmounts before the idle callback fires", () => {
        it("cancels the pending idle callback via cancelIdleCallback", () => {
          let idleCallback: (() => void) | undefined;
          const cancelIdleCallback = vi.fn();
          vi.stubGlobal(
            "requestIdleCallback",
            vi.fn((cb: () => void) => {
              idleCallback = cb;
              return 42;
            }),
          );
          vi.stubGlobal("cancelIdleCallback", cancelIdleCallback);

          const { unmount } = renderHook(() => usePostHog(publicEnvData));
          fireLoadedCallback();

          unmount();

          expect(cancelIdleCallback).toHaveBeenCalledWith(42);

          // Even if something still invokes the stale callback, the
          // cancelled-flag guard must stop it from starting recording.
          idleCallback?.();

          expect(mockStartSessionRecording).not.toHaveBeenCalled();
        });

        it("does not throw when cancelIdleCallback is unavailable", () => {
          let idleCallback: (() => void) | undefined;
          vi.stubGlobal(
            "requestIdleCallback",
            vi.fn((cb: () => void) => {
              idleCallback = cb;
              return 1;
            }),
          );
          vi.stubGlobal("cancelIdleCallback", undefined);

          const { unmount } = renderHook(() => usePostHog(publicEnvData));
          fireLoadedCallback();

          expect(() => unmount()).not.toThrow();

          idleCallback?.();

          expect(mockStartSessionRecording).not.toHaveBeenCalled();
        });
      });
    });

    describe("when requestIdleCallback is unavailable (Safari)", () => {
      describe("when the document has already finished loading", () => {
        beforeEach(() => {
          vi.stubGlobal("requestIdleCallback", undefined);
          vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
          vi.useFakeTimers();
        });

        it("starts session recording on the next tick without waiting for 'load'", () => {
          renderHook(() => usePostHog(publicEnvData));
          fireLoadedCallback();

          expect(mockStartSessionRecording).not.toHaveBeenCalled();

          vi.runAllTimers();

          expect(mockStartSessionRecording).toHaveBeenCalledTimes(1);
        });

        it("cancels the pending timeout if unmounted first", () => {
          const { unmount } = renderHook(() => usePostHog(publicEnvData));
          fireLoadedCallback();

          unmount();
          vi.runAllTimers();

          expect(mockStartSessionRecording).not.toHaveBeenCalled();
        });
      });

      describe("when the document is still loading", () => {
        beforeEach(() => {
          vi.stubGlobal("requestIdleCallback", undefined);
          vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
          vi.useFakeTimers();
        });

        it("defers startSessionRecording until window 'load' fires", () => {
          renderHook(() => usePostHog(publicEnvData));
          fireLoadedCallback();

          expect(mockStartSessionRecording).not.toHaveBeenCalled();

          window.dispatchEvent(new Event("load"));
          vi.runAllTimers();

          expect(mockStartSessionRecording).toHaveBeenCalledTimes(1);
        });

        it("removes the pending 'load' listener if unmounted first", () => {
          const { unmount } = renderHook(() => usePostHog(publicEnvData));
          fireLoadedCallback();

          unmount();
          window.dispatchEvent(new Event("load"));
          vi.runAllTimers();

          expect(mockStartSessionRecording).not.toHaveBeenCalled();
        });
      });
    });
  });
});
