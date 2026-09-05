import { APIError } from "better-auth/api";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setSessionCookie = vi.fn();
vi.mock("better-auth/cookies", () => ({
  setSessionCookie: (...args: unknown[]) => setSessionCookie(...args),
}));

// The bridge under test is constructed here, over the real minter, so the
// request scope and the mint are asserted against each other.
import { PasswordResetSessionBridge } from "../password-reset-session";
import { BetterAuthSessionMinter } from "../session-minter";

/** The after-hook's context, with just the pieces the hook touches. */
const fakeContext = ({
  path,
  returned,
}: {
  path: string;
  returned?: unknown;
}) => {
  const createSession = vi.fn().mockResolvedValue({ id: "session_1" });
  const findUserById = vi.fn().mockResolvedValue({ id: "user_1" });
  return {
    ctx: {
      path,
      context: { returned, internalAdapter: { createSession, findUserById } },
    },
    createSession,
  };
};

let bridge: PasswordResetSessionBridge;

describe("given a request through the password reset endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridge = new PasswordResetSessionBridge({
      minter: new BetterAuthSessionMinter(),
    });
  });

  describe("when the reset was accepted and the callback said who", () => {
    /** @scenario A completed reset opens a session for the device that set the password */
    it("opens a session for that account and sets its cookie", async () => {
      const { ctx, createSession } = fakeContext({ path: "/reset-password" });

      await bridge.runWithScope(async () => {
        bridge.recordPasswordReset({ userId: "user_1" });
        await bridge.signInAfterPasswordReset(ctx);
      });

      expect(createSession).toHaveBeenCalledWith("user_1");
      expect(setSessionCookie).toHaveBeenCalledWith(ctx, {
        session: { id: "session_1" },
        user: { id: "user_1" },
      });
    });

    it("does not fail the reset when no session can be opened", async () => {
      const { ctx, createSession } = fakeContext({ path: "/reset-password" });
      createSession.mockRejectedValue(new Error("session store down"));

      await expect(
        bridge.runWithScope(async () => {
          bridge.recordPasswordReset({ userId: "user_1" });
          await bridge.signInAfterPasswordReset(ctx);
        }),
      ).resolves.toBeUndefined();
      expect(setSessionCookie).not.toHaveBeenCalled();
    });
  });

  describe("when the reset was refused", () => {
    /** @scenario A completed reset opens a session for the device that set the password */
    it("opens nothing", async () => {
      const { ctx, createSession } = fakeContext({
        path: "/reset-password",
        returned: new APIError("BAD_REQUEST", { code: "INVALID_TOKEN" }),
      });

      await bridge.runWithScope(async () => {
        bridge.recordPasswordReset({ userId: "user_1" });
        await bridge.signInAfterPasswordReset(ctx);
      });

      expect(createSession).not.toHaveBeenCalled();
    });
  });

  describe("when the callback never said who", () => {
    it("opens nothing, because nothing was reset", async () => {
      const { ctx, createSession } = fakeContext({ path: "/reset-password" });

      await bridge.runWithScope(() => bridge.signInAfterPasswordReset(ctx));

      expect(createSession).not.toHaveBeenCalled();
    });
  });

  describe("when the request was for any other path", () => {
    it("does nothing, even with a user recorded", async () => {
      const { ctx, createSession } = fakeContext({ path: "/sign-in/email" });

      await bridge.runWithScope(async () => {
        bridge.recordPasswordReset({ userId: "user_1" });
        await bridge.signInAfterPasswordReset(ctx);
      });

      expect(createSession).not.toHaveBeenCalled();
    });
  });

  describe("when no scope was opened around the request", () => {
    it("records nothing and opens nothing", async () => {
      const { ctx, createSession } = fakeContext({ path: "/reset-password" });

      bridge.recordPasswordReset({ userId: "user_1" });
      await bridge.signInAfterPasswordReset(ctx);

      expect(createSession).not.toHaveBeenCalled();
    });
  });

  describe("when better-auth handed the hook no session store", () => {
    it("opens nothing rather than failing the reset", async () => {
      const ctx = { path: "/reset-password", context: {} };

      await expect(
        bridge.runWithScope(async () => {
          bridge.recordPasswordReset({ userId: "user_1" });
          await bridge.signInAfterPasswordReset(ctx);
        }),
      ).resolves.toBeUndefined();
      expect(setSessionCookie).not.toHaveBeenCalled();
    });
  });
});
