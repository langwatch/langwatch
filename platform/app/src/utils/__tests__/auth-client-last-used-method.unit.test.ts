/**
 * @vitest-environment jsdom
 */

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The real module, not the test-setup mock — the behaviour under test lives
// in the session fetch itself.
vi.unmock("~/utils/auth-client");

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    useSession: () => ({ data: null, isPending: true }),
    signIn: { email: vi.fn(), social: vi.fn() },
    signOut: vi.fn(),
  }),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

/** Written by the dial, read by nobody but the promotion. */
const PENDING_KEY = "langwatch.auth.pending-method";

const signedIn = {
  session: { id: "sess-1", userId: "user-1", token: "tok" },
  user: {
    id: "user-1",
    name: "Test User",
    email: "test@example.com",
    image: null,
  },
};

describe("given a social provider was dialled on this browser", () => {
  beforeEach(() => {
    vi.resetModules();
    mockFetch.mockReset();
    window.localStorage.clear();
    window.localStorage.setItem(PENDING_KEY, "google");
  });

  describe("when the browser lands holding a session", () => {
    /** @scenario "A social provider that got me in is badged, wherever the callback lands" */
    it("badges the provider that got the person in", async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => signedIn });

      const { useSession } = await import("../auth-client");
      const { readLastUsedMethodId } = await import(
        "~/features/auth/logic/lastUsedMethod"
      );

      const { result } = renderHook(() => useSession());
      await waitFor(() => {
        expect(result.current.status).toBe("authenticated");
      });

      expect(readLastUsedMethodId()).toBe("google");
    });

    it("leaves nothing parked, so a later landing cannot re-badge it", async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => signedIn });

      const { useSession } = await import("../auth-client");
      const { result } = renderHook(() => useSession());
      await waitFor(() => {
        expect(result.current.status).toBe("authenticated");
      });

      expect(window.localStorage.getItem(PENDING_KEY)).toBeNull();
    });
  });

  describe("when another method gets the person in first", () => {
    /** @scenario "A method I abandoned cannot take the badge from the one that got me in" */
    it("leaves the badge with the method that actually let them in", async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => signedIn });

      const { useSession } = await import("../auth-client");
      const { readLastUsedMethodId, rememberLastUsedMethod } = await import(
        "~/features/auth/logic/lastUsedMethod"
      );

      // Backed out of the consent screen, signed in with a password instead.
      rememberLastUsedMethod({ id: "password" });

      const { result } = renderHook(() => useSession());
      await waitFor(() => {
        expect(result.current.status).toBe("authenticated");
      });

      expect(readLastUsedMethodId()).toBe("password");
    });
  });

  describe("when the browser comes back with no session", () => {
    /** @scenario "A social provider I backed out of is never badged" */
    it("badges nothing", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ session: null, user: null }),
      });

      const { useSession } = await import("../auth-client");
      const { readLastUsedMethodId } = await import(
        "~/features/auth/logic/lastUsedMethod"
      );

      const { result } = renderHook(() => useSession());
      await waitFor(() => {
        expect(result.current.status).toBe("unauthenticated");
      });

      expect(readLastUsedMethodId()).toBeNull();
    });
  });
});
