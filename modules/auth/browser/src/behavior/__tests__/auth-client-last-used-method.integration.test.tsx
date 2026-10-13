/**
 * @vitest-environment jsdom
 * The session fetch every landing passes through is what turns a parked social method into
 * the badge, wherever the provider's callback put the browser.
 * Spec: specs/identity/signin-signup-screens.feature
 */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    useSession: () => ({ data: null, isPending: true }),
    signIn: {},
    signOut: () => Promise.resolve(),
  }),
}));

/** Written by the dial, read by nobody but the promotion. */
const PENDING_KEY = "langwatch.auth.pending-method";

const signedIn = {
  session: { id: "sess-1", userId: "user-1", token: "tok" },
  user: { id: "user-1", name: "Test User", email: "test@example.com", image: null },
};

const answerSessionWith = (body: unknown) =>
  vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify(body))));

/** A fresh module per test: the session cache is module-level by design. */
const landWithSession = async ({ expected }: { expected: string }) => {
  const { useSession } = await import("../auth-client.tsx");
  const { result } = renderHook(() => useSession());
  await waitFor(() => expect(result.current.status).toBe(expected));
};

afterEach(() => vi.unstubAllGlobals());

describe("given a social provider was dialled on this browser", () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
    window.localStorage.setItem(PENDING_KEY, "google");
  });

  describe("when the browser lands anywhere in the app holding a session", () => {
    /** @scenario "A social provider that got me in is badged, wherever the callback lands" */
    it("badges the provider that got the person in", async () => {
      answerSessionWith(signedIn);

      await landWithSession({ expected: "authenticated" });

      const { readLastUsedMethodId } = await import("../../model/last-used-method.ts");
      expect(readLastUsedMethodId()).toBe("google");
    });

    it("leaves nothing parked, so a later landing cannot re-badge it", async () => {
      answerSessionWith(signedIn);

      await landWithSession({ expected: "authenticated" });

      expect(window.localStorage.getItem(PENDING_KEY)).toBeNull();
    });
  });

  describe("when another method got the person in first", () => {
    it("leaves the badge with the method that actually let them in", async () => {
      answerSessionWith(signedIn);
      const { readLastUsedMethodId, rememberLastUsedMethod } =
        await import("../../model/last-used-method.ts");
      rememberLastUsedMethod({ id: "password" });

      await landWithSession({ expected: "authenticated" });

      expect(readLastUsedMethodId()).toBe("password");
    });
  });

  describe("when the browser comes back with no session", () => {
    /** @scenario "A social provider I backed out of is never badged" */
    it("badges nothing", async () => {
      answerSessionWith({ session: null, user: null });

      await landWithSession({ expected: "unauthenticated" });

      const { readLastUsedMethodId } = await import("../../model/last-used-method.ts");
      expect(readLastUsedMethodId()).toBeNull();
    });
  });
});
