/**
 * @vitest-environment jsdom
 * The older session hook follows the same rule as the shell's: a failed read is waited out.
 * Spec: specs/auth/session-failure.feature
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    useSession: () => ({ data: null, isPending: true }),
    signIn: {},
    signOut: () => Promise.resolve(),
  }),
}));

const signedIn = {
  session: { id: "sess-1", userId: "user-1", token: "tok" },
  user: { id: "user-1", name: "Test User", email: "test@example.com", image: null },
};

/** Answers each read with the next status in turn, the last one for good. */
const answerSessionWith = (...replies: { status: number; body?: unknown }[]) => {
  let read = 0;
  vi.stubGlobal("fetch", () => {
    const reply = replies[Math.min(read, replies.length - 1)]!;
    read += 1;
    return Promise.resolve(
      new Response(JSON.stringify(reply.body ?? null), { status: reply.status }),
    );
  });
};

/** A fresh module per test: the session cache is module-level by design. */
const landOnTheApp = async () => {
  const { useSession } = await import("../auth-client.tsx");
  const onUnauthenticated = vi.fn();
  const { result } = renderHook(() => useSession({ required: true, onUnauthenticated }));
  return { result, onUnauthenticated };
};

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("given the session endpoint fails the read without answering", () => {
  describe("when a screen that needs a session reads it", () => {
    /** @scenario "A failed session read is not read as signed out" */
    it("stays loading and sends nobody to sign in", async () => {
      answerSessionWith({ status: 400 });

      const { result, onUnauthenticated } = await landOnTheApp();
      await act(() => vi.advanceTimersByTimeAsync(2_000));

      expect(result.current.status).toBe("loading");
      expect(onUnauthenticated).not.toHaveBeenCalled();
    });
  });

  describe("when a later read answers with a signed-in reader", () => {
    /** @scenario "A reader whose session read recovers carries on unaffected" */
    it("signs them in and sends nobody to sign in", async () => {
      answerSessionWith({ status: 502 }, { status: 200, body: signedIn });

      const { result, onUnauthenticated } = await landOnTheApp();
      await act(() => vi.advanceTimersByTimeAsync(1_000));

      await waitFor(() => expect(result.current.status).toBe("authenticated"));
      expect(onUnauthenticated).not.toHaveBeenCalled();
    });
  });
});

describe("given the session endpoint answers 401", () => {
  /** @scenario "A session endpoint answering 401 means nobody is signed in" */
  it("reads nobody signed in", async () => {
    answerSessionWith({ status: 401 });

    const { result, onUnauthenticated } = await landOnTheApp();

    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));
    expect(onUnauthenticated).toHaveBeenCalled();
  });
});
