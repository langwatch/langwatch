import { IdentityVerificationExpiredError } from "@langwatch/identity";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The three things the endpoint reaches for: the service that spends the
// link, the directory that finds the account it confirmed, and better-auth's
// own session writer and cookie setter. The endpoint under test is the real
// one the plugin mounts.
const completeVerification = vi.fn();
vi.mock("~/server/app-layer/identity/runtime", () => ({
  signUpVerification: () => ({
    completeVerification: (...args: unknown[]) => completeVerification(...args),
  }),
}));

const findFirst = vi.fn();
vi.mock("~/server/db", () => ({
  prisma: { user: { findFirst: (...args: unknown[]) => findFirst(...args) } },
}));

const setSessionCookie = vi.fn();
vi.mock("better-auth/cookies", () => ({
  setSessionCookie: (...args: unknown[]) => setSessionCookie(...args),
}));

import {
  confirmSignUpAddress,
  SIGN_UP_CONFIRM_ADDRESS_PATH,
  signUpConfirmation,
} from "../sign-up-confirmation";

/** The endpoint the plugin mounts; its handler is driven directly below. */
const endpoint = signUpConfirmation().endpoints.confirmSignUpAddress;

/** A plugin context with just the pieces the handler touches. */
const fakeContext = ({ token }: { token: string }) => {
  const createSession = vi.fn().mockResolvedValue({ id: "session_1" });
  const findUserById = vi
    .fn()
    .mockResolvedValue({ id: "user_1", email: "sam@acme.com" });
  const json = vi.fn((body: unknown, init?: { status?: number }) => ({
    body,
    status: init?.status ?? 200,
  }));
  const ctx = {
    body: { token },
    json,
    context: { internalAdapter: { createSession, findUserById } },
  };
  return { ctx, createSession, findUserById, json };
};

const run = async (ctx: unknown) =>
  (await confirmSignUpAddress(ctx as never)) as {
    body: Record<string, unknown>;
    status: number;
  };

describe("given the sign-up confirmation endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirst.mockResolvedValue({ id: "user_1" });
  });

  it("is mounted on the path the screen posts to", () => {
    expect(endpoint.path).toBe(SIGN_UP_CONFIRM_ADDRESS_PATH);
    expect(SIGN_UP_CONFIRM_ADDRESS_PATH).toBe("/sign-up/confirm-address");
  });

  describe("when the link confirms an account that exists", () => {
    beforeEach(() => {
      completeVerification.mockResolvedValue({
        email: "sam@acme.com",
        accountCreated: false,
        accountExists: true,
        addressProof: null,
      });
    });

    /** @scenario Opening the link is what signs me in for the first time */
    it("opens the account's session and sets its cookie", async () => {
      const { ctx, createSession, json } = fakeContext({ token: "a-token" });

      const answer = await run(ctx);

      expect(completeVerification).toHaveBeenCalledWith({ token: "a-token" });
      expect(createSession).toHaveBeenCalledWith("user_1");
      expect(setSessionCookie).toHaveBeenCalledWith(ctx, {
        session: { id: "session_1" },
        user: { id: "user_1", email: "sam@acme.com" },
      });
      expect(json).toHaveBeenCalledOnce();
      expect(answer.body).toMatchObject({
        email: "sam@acme.com",
        accountExists: true,
        signedIn: true,
      });
    });

    it("finds the account whatever case its address was stored in", async () => {
      const { ctx } = fakeContext({ token: "a-token" });

      await run(ctx);

      expect(findFirst).toHaveBeenCalledWith({
        where: { email: { equals: "sam@acme.com", mode: "insensitive" } },
        select: { id: true },
      });
    });

    it("still confirms when no session can be opened", async () => {
      const { ctx, createSession } = fakeContext({ token: "a-token" });
      createSession.mockRejectedValue(new Error("session store down"));

      const answer = await run(ctx);

      // The address IS confirmed; the screen offers the way in instead.
      expect(answer.body).toMatchObject({
        accountExists: true,
        signedIn: false,
      });
      expect(setSessionCookie).not.toHaveBeenCalled();
    });
  });

  describe("when the link confirms an address with no account behind it", () => {
    /** @scenario Signing in without an account creates it through verification */
    it("opens nothing and hands the proof on", async () => {
      completeVerification.mockResolvedValue({
        email: "sam@acme.com",
        accountCreated: false,
        accountExists: false,
        addressProof: "proof-1",
      });
      const { ctx, createSession } = fakeContext({ token: "a-token" });

      const answer = await run(ctx);

      expect(createSession).not.toHaveBeenCalled();
      expect(setSessionCookie).not.toHaveBeenCalled();
      expect(answer.body).toMatchObject({
        accountExists: false,
        addressProof: "proof-1",
        signedIn: false,
      });
    });
  });

  describe("when the link no longer works", () => {
    /** @scenario An expired verification link offers a resend, nothing else */
    it("answers the refusal in the body shape the screen reads", async () => {
      completeVerification.mockRejectedValue(
        new IdentityVerificationExpiredError(),
      );
      const { ctx, createSession } = fakeContext({ token: "stale" });

      const answer = await run(ctx);

      expect(answer.status).toBe(410);
      expect(answer.body).toMatchObject({
        error: "identity_verification_expired",
      });
      expect(createSession).not.toHaveBeenCalled();
    });

    it("lets a failure it cannot name degrade to the generic answer", async () => {
      completeVerification.mockRejectedValue(new Error("token store down"));
      const { ctx } = fakeContext({ token: "a-token" });

      await expect(run(ctx)).rejects.toThrow("token store down");
    });
  });
});
