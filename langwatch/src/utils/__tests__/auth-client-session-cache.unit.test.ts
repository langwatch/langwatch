/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// We need to test the real module, not the test-setup mock
vi.unmock("~/utils/auth-client");

// Mock better-auth/react before importing auth-client
vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    useSession: () => ({ data: null, isPending: true }),
    signIn: { email: vi.fn(), social: vi.fn() },
    signOut: vi.fn(),
  }),
}));

// Mock fetch for session requests
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Fresh import for each describe block — module-level cache persists across tests
// so we use dynamic import + resetModules
describe("useSession session caching", () => {
  beforeEach(() => {
    vi.resetModules();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockSessionResponse = {
    session: { id: "sess-1", userId: "user-1", token: "tok" },
    user: { id: "user-1", name: "Test User", email: "test@example.com", image: null },
  };

  it("fetches session only once across multiple hook instances", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockSessionResponse,
    });

    const { useSession } = await import("../auth-client");

    const { result: result1 } = renderHook(() => useSession());
    const { result: result2 } = renderHook(() => useSession());

    await waitFor(() => {
      expect(result1.current.status).toBe("authenticated");
    });

    await waitFor(() => {
      expect(result2.current.status).toBe("authenticated");
    });

    // Only ONE fetch call despite two hooks mounting
    const sessionCalls = mockFetch.mock.calls.filter(
      (call) => typeof call[0] === "string" && call[0].includes("/api/auth/session")
    );
    expect(sessionCalls).toHaveLength(1);
  });

  it("returns cached session immediately on subsequent mounts (no flash)", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockSessionResponse,
    });

    const { useSession } = await import("../auth-client");

    // First mount — fetches
    const { result: first, unmount } = renderHook(() => useSession());
    await waitFor(() => {
      expect(first.current.status).toBe("authenticated");
    });

    // Unmount first hook (simulates page navigation)
    unmount();

    // Reset fetch to track new calls
    mockFetch.mockClear();

    // Second mount — should have cached data immediately
    const { result: second } = renderHook(() => useSession());

    // IMMEDIATELY has data (no "loading" state)
    expect(second.current.data).not.toBeNull();
    expect(second.current.data?.user.email).toBe("test@example.com");
    expect(second.current.status).toBe("authenticated");

    // No new fetch calls — served from cache
    const sessionCalls = mockFetch.mock.calls.filter(
      (call) => typeof call[0] === "string" && call[0].includes("/api/auth/session")
    );
    expect(sessionCalls).toHaveLength(0);
  });

  it("clears cache on signOut", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockSessionResponse,
    });

    const mod = await import("../auth-client");

    // First mount — fetches and caches
    const { result, unmount } = renderHook(() => mod.useSession());
    await waitFor(() => {
      expect(result.current.status).toBe("authenticated");
    });
    unmount();

    // Sign out — clears cache
    // signOut navigates to /api/auth/logout, so we just test the cache clear
    // by calling signOut with redirect: false
    mockFetch.mockResolvedValueOnce({ ok: true });
    await act(async () => {
      await mod.signOut({ redirect: false });
    });

    // Next mount should start with null (cache cleared)
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockSessionResponse,
    });
    const { result: afterLogout } = renderHook(() => mod.useSession());

    // Initially pending since cache was cleared
    expect(afterLogout.current.status).toBe("loading");
  });
});
