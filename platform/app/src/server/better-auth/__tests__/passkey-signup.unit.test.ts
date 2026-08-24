import { beforeEach, describe, expect, it, vi } from "vitest";

// The three boundaries the registration callbacks reach for: the directory
// they ask "does this address have an account", the writer that creates one,
// and the mailer the confirmation follows through. The callbacks under test
// are the real ones handed to the plugin.
const findFirst = vi.fn();
vi.mock("~/server/db", () => ({
  prisma: { user: { findFirst: (...args: unknown[]) => findFirst(...args) } },
}));

const createPasskeyUser = vi.fn();
vi.mock("~/server/users/credential-user", () => ({
  createPasskeyUser: (...args: unknown[]) => createPasskeyUser(...args),
}));

const requestVerification = vi.fn();
vi.mock("~/server/app-layer/identity/runtime", () => ({
  signUpVerification: () => ({
    requestVerification: (...args: unknown[]) => requestVerification(...args),
  }),
}));

// Writing the session cookie is BetterAuth's own, and it wants the whole
// endpoint context to do it. What matters here is that it is called with the
// session that was just opened, which is what the stub records.
const setSessionCookie = vi.fn();
vi.mock("better-auth/cookies", () => ({
  setSessionCookie: (...args: unknown[]) => setSessionCookie(...args),
}));

import {
  PASSKEY_SIGNUP_EMAIL_INVALID,
  PASSKEY_SIGNUP_EMAIL_TAKEN,
  passkeySignUpRegistration,
} from "../passkey-signup";

/** A plugin context with just the pieces the callbacks touch. */
const fakeContext = () => {
  const createSession = vi.fn().mockResolvedValue({ id: "session_1" });
  const findUserById = vi.fn().mockResolvedValue({ id: "user_1" });
  return {
    ctx: {
      context: { internalAdapter: { createSession, findUserById } },
      setCookie: vi.fn(),
      // `setSessionCookie` writes through the response headers the endpoint
      // context carries; a bare object is enough for the callback to run.
      responseHeaders: new Headers(),
      headers: new Headers(),
      context_: null,
    } as never,
    createSession,
  };
};

const resolveUser = passkeySignUpRegistration.resolveUser;
const afterVerification = passkeySignUpRegistration.afterVerification;

describe("given passkey sign-up, which creates an account with no session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirst.mockResolvedValue(null);
    createPasskeyUser.mockResolvedValue({ id: "user_1" });
    requestVerification.mockResolvedValue(void 0);
  });

  describe("when the address already has an account", () => {
    /**
     * The one that matters. Without it, dropping the session requirement from
     * the registration endpoints would let anybody attach their own passkey to
     * anybody else's account by naming the address — a total takeover with no
     * credential involved.
     */
    /** @scenario A passkey is never registered against an address that already has an account */
    it("refuses to start a ceremony for somebody else's address", async () => {
      findFirst.mockResolvedValue({ id: "someone_else" });

      await expect(
        resolveUser({ ctx: fakeContext().ctx, context: "victim@corp.com" }),
      ).rejects.toMatchObject({
        body: { code: PASSKEY_SIGNUP_EMAIL_TAKEN },
      });
    });

    it("refuses again after the ceremony, in case it was taken in between", async () => {
      const { ctx } = fakeContext();
      findFirst.mockResolvedValue({ id: "someone_else" });

      await expect(
        afterVerification({ ctx, context: "victim@corp.com" }),
      ).rejects.toMatchObject({ body: { code: PASSKEY_SIGNUP_EMAIL_TAKEN } });
      expect(createPasskeyUser).not.toHaveBeenCalled();
    });

    it("matches the address whatever case it was stored in", async () => {
      findFirst.mockResolvedValue({ id: "someone_else" });

      await resolveUser({
        ctx: fakeContext().ctx,
        context: "victim@corp.com",
      }).catch(() => void 0);

      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { email: { equals: "victim@corp.com", mode: "insensitive" } },
        }),
      );
    });
  });

  describe("when no address was carried at all", () => {
    it("refuses rather than minting a handle for nobody", async () => {
      await expect(
        resolveUser({ ctx: fakeContext().ctx, context: null }),
      ).rejects.toMatchObject({
        body: { code: PASSKEY_SIGNUP_EMAIL_INVALID },
      });
    });

    it("refuses something that is not an address", async () => {
      await expect(
        resolveUser({ ctx: fakeContext().ctx, context: "not-an-address" }),
      ).rejects.toMatchObject({
        body: { code: PASSKEY_SIGNUP_EMAIL_INVALID },
      });
    });
  });

  describe("when the address is free", () => {
    it("shows the address in the prompt, which is what a person recognises", async () => {
      const resolved = await resolveUser({
        ctx: fakeContext().ctx,
        context: "Someone@Example.com",
      });

      expect(resolved.name).toBe("someone@example.com");
      expect(resolved.displayName).toBe("someone@example.com");
    });

    it("hands the authenticator a handle that is not the address", async () => {
      const resolved = await resolveUser({
        ctx: fakeContext().ctx,
        context: "someone@example.com",
      });

      expect(resolved.id).not.toContain("someone");
      expect(resolved.id).not.toContain("@");
    });

    it("hands back the same handle every time, so a retry replaces the credential", async () => {
      const first = await resolveUser({
        ctx: fakeContext().ctx,
        context: "someone@example.com",
      });
      const second = await resolveUser({
        ctx: fakeContext().ctx,
        context: "someone@example.com",
      });

      expect(first.id).toBe(second.id);
    });

    it("creates nothing merely for being asked", async () => {
      await resolveUser({
        ctx: fakeContext().ctx,
        context: "someone@example.com",
      });

      expect(createPasskeyUser).not.toHaveBeenCalled();
    });
  });

  describe("when the ceremony has succeeded", () => {
    it("creates the account for the address the ceremony was started with", async () => {
      const { ctx } = fakeContext();

      await afterVerification({ ctx, context: "Someone@Example.com" });

      expect(createPasskeyUser).toHaveBeenCalledWith(
        expect.objectContaining({ email: "someone@example.com" }),
      );
    });

    it("attaches the passkey to the account rather than to the handle", async () => {
      const { ctx } = fakeContext();

      const result = await afterVerification({
        ctx,
        context: "someone@example.com",
      });

      expect(result.userId).toBe("user_1");
    });

    /**
     * `verify-registration` establishes no session of its own. Without this
     * the browser would hold a credential for an account it is not signed in
     * to, and getting in would take a second system prompt straight after the
     * first — which reads as the first one having failed.
     */
    /** @scenario Signing up with a passkey creates the account and the session together */
    it("opens the session itself, so nobody is prompted twice", async () => {
      const { ctx, createSession } = fakeContext();

      await afterVerification({ ctx, context: "someone@example.com" });

      expect(createSession).toHaveBeenCalledWith("user_1");
      expect(setSessionCookie).toHaveBeenCalledWith(
        ctx,
        expect.objectContaining({ session: { id: "session_1" } }),
      );
    });

    it("sends the address confirmation after them, not in front of them", async () => {
      const { ctx } = fakeContext();

      await afterVerification({ ctx, context: "someone@example.com" });

      expect(requestVerification).toHaveBeenCalledWith({
        email: "someone@example.com",
      });
    });

    it("finishes the sign-up even when the mailer is down", async () => {
      const { ctx } = fakeContext();
      requestVerification.mockRejectedValue(new Error("mailer unreachable"));

      await expect(
        afterVerification({ ctx, context: "someone@example.com" }),
      ).resolves.toMatchObject({ userId: "user_1" });
    });
  });
});
