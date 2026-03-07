/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Mock posthog-js
const mockPosthog = {
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
  people: {
    set: vi.fn(),
  },
  __loaded: true,
};

vi.mock("posthog-js", () => ({
  default: mockPosthog,
}));

// Mock next-auth/react
const mockSession = {
  data: null as { user: { id: string; email: string; name: string } } | null,
};

vi.mock("next-auth/react", () => ({
  useSession: () => mockSession,
}));

// Mock next/router
const mockRouterEvents = {
  on: vi.fn(),
  off: vi.fn(),
};

const mockRouter = {
  events: mockRouterEvents,
  query: {} as Record<string, string>,
};

vi.mock("next/router", () => ({
  useRouter: () => mockRouter,
}));

// Mock usePublicEnv
const mockPublicEnv = {
  data: null as { POSTHOG_KEY?: string; POSTHOG_HOST?: string; NODE_ENV?: string } | null,
};

vi.mock("./usePublicEnv", () => ({
  usePublicEnv: () => mockPublicEnv,
}));

import { usePostHog } from "../usePostHog";

describe("usePostHog()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPosthog.__loaded = true;
    mockSession.data = null;
    mockPublicEnv.data = null;
    mockRouter.query = {};
  });

  describe("when PostHog key is not configured", () => {
    beforeEach(() => {
      mockPublicEnv.data = { POSTHOG_KEY: undefined };
    });

    it("returns undefined", () => {
      const { result } = renderHook(() => usePostHog());
      expect(result.current).toBeUndefined();
    });

    it("does not initialize PostHog", () => {
      renderHook(() => usePostHog());
      expect(mockPosthog.init).not.toHaveBeenCalled();
    });
  });

  describe("when PostHog key is configured", () => {
    beforeEach(() => {
      mockPublicEnv.data = { POSTHOG_KEY: "phc_test_key", POSTHOG_HOST: "https://eu.posthog.com" };
    });

    it("returns posthog instance", () => {
      const { result } = renderHook(() => usePostHog());
      expect(result.current).toBe(mockPosthog);
    });

    it("initializes PostHog with key and host", () => {
      renderHook(() => usePostHog());
      expect(mockPosthog.init).toHaveBeenCalledWith(
        "phc_test_key",
        expect.objectContaining({
          api_host: "https://eu.posthog.com",
          person_profiles: "always",
        })
      );
    });

    it("registers pageview handler on route changes", () => {
      renderHook(() => usePostHog());
      expect(mockRouterEvents.on).toHaveBeenCalledWith(
        "routeChangeComplete",
        expect.any(Function)
      );
    });
  });

  describe("user identification", () => {
    beforeEach(() => {
      mockPublicEnv.data = { POSTHOG_KEY: "phc_test_key" };
    });

    describe("when user is not logged in", () => {
      beforeEach(() => {
        mockSession.data = null;
      });

      it("does not call identify", () => {
        renderHook(() => usePostHog());
        expect(mockPosthog.identify).not.toHaveBeenCalled();
      });
    });

    describe("when user logs in", () => {
      it("identifies user with id, email, and name", () => {
        mockSession.data = null;
        const { rerender } = renderHook(() => usePostHog());

        // Simulate login
        mockSession.data = {
          user: { id: "user-123", email: "test@example.com", name: "Test User" },
        };
        rerender();

        expect(mockPosthog.identify).toHaveBeenCalledWith("user-123", {
          email: "test@example.com",
          name: "Test User",
        });
      });

      it("identifies only once for same user", () => {
        mockSession.data = {
          user: { id: "user-123", email: "test@example.com", name: "Test User" },
        };

        const { rerender } = renderHook(() => usePostHog());
        rerender();
        rerender();

        expect(mockPosthog.identify).toHaveBeenCalledTimes(1);
      });
    });

    describe("when user logs out", () => {
      it("resets PostHog", () => {
        // Start logged in
        mockSession.data = {
          user: { id: "user-123", email: "test@example.com", name: "Test User" },
        };
        const { rerender } = renderHook(() => usePostHog());

        // Simulate logout
        mockSession.data = null;
        rerender();

        expect(mockPosthog.reset).toHaveBeenCalled();
      });
    });

    describe("when user switches accounts", () => {
      it("identifies new user", () => {
        // Start as user 1
        mockSession.data = {
          user: { id: "user-1", email: "user1@example.com", name: "User One" },
        };
        const { rerender } = renderHook(() => usePostHog());

        // Switch to user 2
        mockSession.data = {
          user: { id: "user-2", email: "user2@example.com", name: "User Two" },
        };
        rerender();

        expect(mockPosthog.identify).toHaveBeenCalledTimes(2);
        expect(mockPosthog.identify).toHaveBeenLastCalledWith("user-2", {
          email: "user2@example.com",
          name: "User Two",
        });
      });
    });
  });

  describe("project context tracking", () => {
    beforeEach(() => {
      mockPublicEnv.data = { POSTHOG_KEY: "phc_test_key" };
      mockSession.data = {
        user: { id: "user-123", email: "test@example.com", name: "Test User" },
      };
    });

    describe("when project slug is in URL", () => {
      it("sets current_project_slug as person property", () => {
        mockRouter.query = { project: "my-project" };
        renderHook(() => usePostHog());

        expect(mockPosthog.people.set).toHaveBeenCalledWith({
          current_project_slug: "my-project",
        });
      });
    });

    describe("when project slug changes", () => {
      it("updates person property", () => {
        mockRouter.query = { project: "project-a" };
        const { rerender } = renderHook(() => usePostHog());

        mockRouter.query = { project: "project-b" };
        rerender();

        expect(mockPosthog.people.set).toHaveBeenCalledWith({
          current_project_slug: "project-b",
        });
      });
    });

    describe("when no project in URL", () => {
      it("does not set project property", () => {
        mockRouter.query = {};
        renderHook(() => usePostHog());

        expect(mockPosthog.people.set).not.toHaveBeenCalled();
      });
    });
  });
});
