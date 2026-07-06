/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted() is required: vi.mock() factories are hoisted to the top of the
// file, so any variable they reference directly must also be hoisted — otherwise
// we hit a temporal dead zone error.
const {
  mockInit,
  mockStartSessionRecording,
  mockDebug,
  mockIdentify,
  mockReset,
  mockPeopleSet,
  mockPosthogLoaded,
} = vi.hoisted(() => {
  const loaded = { value: true };
  return {
    mockInit: vi.fn(),
    mockStartSessionRecording: vi.fn(),
    mockDebug: vi.fn(),
    mockIdentify: vi.fn(),
    mockReset: vi.fn(),
    mockPeopleSet: vi.fn(),
    // Boxed so tests can toggle __loaded without re-creating the object.
    mockPosthogLoaded: loaded,
  };
});

vi.mock("posthog-js", () => ({
  default: {
    init: mockInit,
    startSessionRecording: mockStartSessionRecording,
    debug: mockDebug,
    identify: mockIdentify,
    reset: mockReset,
    people: { set: mockPeopleSet },
    get __loaded() {
      return mockPosthogLoaded.value;
    },
  },
}));

// --- publicEnv mock (used by init tests) ---
let publicEnvData: Record<string, unknown> | undefined = {
  POSTHOG_KEY: "test-key",
  POSTHOG_HOST: "https://eu.i.posthog.com",
  NODE_ENV: "test",
};

vi.mock("../usePublicEnv", () => ({
  usePublicEnv: () => ({ data: publicEnvData }),
}));

// --- session mock (used by identify tests) ---
const mockSession = {
  data: null as { user: { id: string; email: string; name: string } } | null,
};

vi.mock("~/utils/auth-client", () => ({
  useSession: () => mockSession,
}));

// --- router mock (used by project-context tests) ---
const mockRouter = {
  events: { on: vi.fn(), off: vi.fn() },
  query: {} as Record<string, string>,
};

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => mockRouter,
}));

import { usePostHog } from "../usePostHog";

function fireLoadedCallback() {
  const { loaded } = mockInit.mock.calls[0]![1] as {
    loaded: (posthog: unknown) => void;
  };
  loaded({ debug: mockDebug });
}

// ─────────────────────────────────────────────────────────────────
// Init / session-recording tests (preserved from main)
// ─────────────────────────────────────────────────────────────────
describe("usePostHog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPosthogLoaded.value = true;
    publicEnvData = {
      POSTHOG_KEY: "test-key",
      POSTHOG_HOST: "https://eu.i.posthog.com",
      NODE_ENV: "test",
    };
    mockSession.data = null;
    mockRouter.query = {};
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

      renderHook(() => usePostHog());

      expect(mockInit).not.toHaveBeenCalled();
    });

    it("returns undefined", () => {
      publicEnvData = undefined;

      const { result } = renderHook(() => usePostHog());

      expect(result.current).toBeUndefined();
    });
  });

  describe("when publicEnv has loaded but there is no POSTHOG_KEY", () => {
    it("does not call posthog.init", () => {
      publicEnvData = { POSTHOG_KEY: undefined, NODE_ENV: "test" };

      renderHook(() => usePostHog());

      expect(mockInit).not.toHaveBeenCalled();
    });

    it("returns undefined", () => {
      publicEnvData = { POSTHOG_KEY: undefined, NODE_ENV: "test" };

      const { result } = renderHook(() => usePostHog());

      expect(result.current).toBeUndefined();
    });
  });

  describe("when a POSTHOG_KEY is present", () => {
    it("calls posthog.init with the key", () => {
      renderHook(() => usePostHog());

      expect(mockInit).toHaveBeenCalledWith("test-key", expect.any(Object));
    });

    it("returns the posthog client", () => {
      const { result } = renderHook(() => usePostHog());

      expect(result.current).toBeDefined();
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

    it("keeps core capture options eager and unchanged", () => {
      renderHook(() => usePostHog());

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
      renderHook(() => usePostHog());

      expect(mockStartSessionRecording).not.toHaveBeenCalled();
    });
  });

  describe("given a POSTHOG_HOST is provided", () => {
    it("uses it as api_host", () => {
      publicEnvData = {
        POSTHOG_KEY: "test-key",
        POSTHOG_HOST: "https://self-hosted.example.com",
        NODE_ENV: "test",
      };

      renderHook(() => usePostHog());

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
      publicEnvData = { POSTHOG_KEY: "test-key", NODE_ENV: "test" };

      renderHook(() => usePostHog());

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
      renderHook(() => usePostHog());

      fireLoadedCallback();

      expect((window as { posthog?: unknown }).posthog).toBeDefined();
    });

    describe("given NODE_ENV is development", () => {
      it("enables posthog debug logging", () => {
        publicEnvData = {
          POSTHOG_KEY: "test-key",
          NODE_ENV: "development",
        };

        renderHook(() => usePostHog());
        fireLoadedCallback();

        expect(mockDebug).toHaveBeenCalledTimes(1);
      });
    });

    describe("given NODE_ENV is not development", () => {
      it("does not enable posthog debug logging", () => {
        publicEnvData = { POSTHOG_KEY: "test-key", NODE_ENV: "production" };

        renderHook(() => usePostHog());
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

        renderHook(() => usePostHog());
        fireLoadedCallback();

        expect(mockStartSessionRecording).not.toHaveBeenCalled();

        idleCallback?.();

        expect(mockStartSessionRecording).toHaveBeenCalledTimes(1);
      });

      it("passes a timeout so the callback can't wait forever", () => {
        const requestIdleCallback = vi.fn(() => 1);
        vi.stubGlobal("requestIdleCallback", requestIdleCallback);

        renderHook(() => usePostHog());
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

          const { unmount } = renderHook(() => usePostHog());
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

          const { unmount } = renderHook(() => usePostHog());
          fireLoadedCallback();

          expect(() => unmount()).not.toThrow();

          idleCallback?.();

          expect(mockStartSessionRecording).not.toHaveBeenCalled();
        });
      });
    });

    describe("when requestIdleCallback is unavailable (Safari)", () => {
      describe("when the document has already finished loading", () => {
        it("starts session recording on the next tick without waiting for 'load'", () => {
          vi.stubGlobal("requestIdleCallback", undefined);
          vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
          vi.useFakeTimers();

          renderHook(() => usePostHog());
          fireLoadedCallback();

          expect(mockStartSessionRecording).not.toHaveBeenCalled();

          vi.runAllTimers();

          expect(mockStartSessionRecording).toHaveBeenCalledTimes(1);
        });

        it("cancels the pending timeout if unmounted first", () => {
          vi.stubGlobal("requestIdleCallback", undefined);
          vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
          vi.useFakeTimers();

          const { unmount } = renderHook(() => usePostHog());
          fireLoadedCallback();

          unmount();
          vi.runAllTimers();

          expect(mockStartSessionRecording).not.toHaveBeenCalled();
        });
      });

      describe("when the document is still loading", () => {
        it("defers startSessionRecording until window 'load' fires", () => {
          vi.stubGlobal("requestIdleCallback", undefined);
          vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
          vi.useFakeTimers();

          renderHook(() => usePostHog());
          fireLoadedCallback();

          expect(mockStartSessionRecording).not.toHaveBeenCalled();

          window.dispatchEvent(new Event("load"));
          vi.runAllTimers();

          expect(mockStartSessionRecording).toHaveBeenCalledTimes(1);
        });

        it("removes the pending 'load' listener if unmounted first", () => {
          vi.stubGlobal("requestIdleCallback", undefined);
          vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
          vi.useFakeTimers();

          const { unmount } = renderHook(() => usePostHog());
          fireLoadedCallback();

          unmount();
          window.dispatchEvent(new Event("load"));
          vi.runAllTimers();

          expect(mockStartSessionRecording).not.toHaveBeenCalled();
        });
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // User identification tests
  // ─────────────────────────────────────────────────────────────────
  describe("user identification", () => {
    describe("when user is not logged in", () => {
      it("does not call identify", () => {
        mockSession.data = null;

        renderHook(() => usePostHog());

        expect(mockIdentify).not.toHaveBeenCalled();
      });
    });

    describe("when user logs in", () => {
      it("identifies user by internal user ID only (no PII forwarded)", () => {
        mockSession.data = null;
        const { rerender } = renderHook(() => usePostHog());

        mockSession.data = {
          user: { id: "user-123", email: "test@example.com", name: "Test User" },
        };
        rerender();

        expect(mockIdentify).toHaveBeenCalledWith("user-123");
      });

      it("identifies only once for the same user across re-renders", () => {
        mockSession.data = {
          user: { id: "user-123", email: "test@example.com", name: "Test User" },
        };

        const { rerender } = renderHook(() => usePostHog());
        rerender();
        rerender();

        expect(mockIdentify).toHaveBeenCalledTimes(1);
      });
    });

    describe("when user logs out", () => {
      it("resets PostHog", () => {
        mockSession.data = {
          user: { id: "user-123", email: "test@example.com", name: "Test User" },
        };
        const { rerender } = renderHook(() => usePostHog());

        mockSession.data = null;
        rerender();

        expect(mockReset).toHaveBeenCalled();
      });
    });

    describe("when user switches accounts", () => {
      it("re-identifies with new user credentials", () => {
        mockSession.data = {
          user: { id: "user-1", email: "user1@example.com", name: "User One" },
        };
        const { rerender } = renderHook(() => usePostHog());

        mockSession.data = {
          user: { id: "user-2", email: "user2@example.com", name: "User Two" },
        };
        rerender();

        expect(mockIdentify).toHaveBeenCalledTimes(2);
        expect(mockIdentify).toHaveBeenLastCalledWith("user-2");
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Project context tracking tests
  // ─────────────────────────────────────────────────────────────────
  describe("project context tracking", () => {
    beforeEach(() => {
      mockSession.data = {
        user: { id: "user-123", email: "test@example.com", name: "Test User" },
      };
    });

    describe("when project slug is in URL", () => {
      it("sets current_project_slug as a person property", () => {
        mockRouter.query = { project: "my-project" };

        renderHook(() => usePostHog());

        expect(mockPeopleSet).toHaveBeenCalledWith({
          current_project_slug: "my-project",
        });
      });
    });

    describe("when project slug changes", () => {
      it("updates the person property to the new slug", () => {
        mockRouter.query = { project: "project-a" };
        const { rerender } = renderHook(() => usePostHog());

        mockRouter.query = { project: "project-b" };
        rerender();

        expect(mockPeopleSet).toHaveBeenCalledWith({
          current_project_slug: "project-b",
        });
      });
    });

    describe("when no project slug is in URL", () => {
      it("does not set the project person property", () => {
        mockRouter.query = {};

        renderHook(() => usePostHog());

        expect(mockPeopleSet).not.toHaveBeenCalled();
      });
    });
  });
});
