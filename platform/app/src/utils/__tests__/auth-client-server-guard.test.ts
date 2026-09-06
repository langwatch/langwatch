/**
 * Regression test for the iter-18 bug: `getSession()` from auth-client.tsx
 * was previously called from server-side props (admin page SSR, signin/signup
 * SSR redirects, tRPC server-side helpers), where it silently returned null
 * because the BetterAuth React client has no access to request cookies on
 * the server. Server-side callers must use `getServerAuthSession` from
 * `~/server/auth` instead. This test locks in the explicit failure mode so
 * a future regression doesn't reintroduce the silent-null behavior.
 */
import { afterAll, describe, expect, it, vi } from "vitest";

// Force a non-browser environment for this test, even though vitest defaults
// to jsdom for the project. We delete `window` so the guard's
// `typeof window === "undefined"` check fires.
vi.stubGlobal("window", undefined);

// Restore the stub after this file so other test files that rely on
// jsdom's `window` don't leak the stubbed-undefined state. Caught by
// CodeRabbit in PR review.
afterAll(() => {
  vi.unstubAllGlobals();
});

describe("auth-client getSession server-side guard", () => {
  it("throws a descriptive error when called from a non-browser context", async () => {
    const { getSession } = await import("../auth-client");
    await expect(getSession()).rejects.toThrow(
      /server context.*getServerAuthSession/i,
    );
  });
});
