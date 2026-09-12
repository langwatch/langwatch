import { IdentityVerificationExpiredError } from "@langwatch/identity";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setSessionCookie = vi.fn();
vi.mock("better-auth/cookies", () => ({
  setSessionCookie: (...args: unknown[]) => setSessionCookie(...args),
}));

// The endpoint under test is constructed here, over the real minter and
// in-memory stand-ins for the service that spends the link and the directory
// that finds the account it confirmed.
import { BetterAuthSessionMinter } from "../session-minter";
import {
  SIGN_UP_CONFIRM_ADDRESS_PATH,
  SignUpConfirmationEndpoint,
  signUpConfirmation,
} from "../sign-up-confirmation";

const completeVerification = vi.fn();
const findUserIdByEmail = vi.fn();

const endpoint = () =>
  new SignUpConfirmationEndpoint({
    verification: { completeVerification },
    users: { findUserIdByEmail },
    minter: new BetterAuthSessionMinter(),
  });

/** The endpoint the plugin mounts. */
const mounted = signUpConfirmation({
  confirmSignUpAddress: (ctx) => endpoint().confirmSignUpAddress(ctx),
}).endpoints.confirmSignUpAddress;

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
  const setStatus = vi.fn();
  const ctx = {
    body: { token },
    json,
    setStatus,
    context: { internalAdapter: { createSession, findUserById } },
  };
  return { ctx, createSession, findUserById, json, setStatus };
};

const run = async (ctx: ReturnType<typeof fakeContext>["ctx"]) =>
  (await endpoint().confirmSignUpAddress(ctx)) as {
    body: Record<string, unknown>;
    status: number;
  };

describe("given the sign-up confirmation endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUserIdByEmail.mockResolvedValue("user_1");
  });

  it("is mounted on the path the screen posts to", () => {
    expect(mounted.path).toBe(SIGN_UP_CONFIRM_ADDRESS_PATH);
    expect(SIGN_UP_CONFIRM_ADDRESS_PATH).toBe("/sign-up/confirm-address");
  });

  describe("when the link confirms a fresh address", () => {
    beforeEach(() => {
      completeVerification.mockResolvedValue({
        email: "sam@acme.com",
        accountCreated: false,
        accountExists: false,
        addressProof: "proof-1",
        freshClaim: true,
      });
    });

    /** @scenario "Opening the link unlocks credential choice" */
    it("hands the proof on without opening a session", async () => {
      const { ctx, createSession, json } = fakeContext({ token: "a-token" });

      const answer = await run(ctx);

      expect(createSession).not.toHaveBeenCalled();
      expect(setSessionCookie).not.toHaveBeenCalled();
      expect(json).toHaveBeenCalledOnce();
      expect(answer.body).toMatchObject({
        email: "sam@acme.com",
        accountExists: false,
        addressProof: "proof-1",
        signedIn: false,
      });
    });
  });

  describe("when the fresh proof link is replayed", () => {
    beforeEach(() => {
      completeVerification.mockResolvedValue({
        email: "sam@acme.com",
        accountCreated: false,
        accountExists: false,
        addressProof: null,
        freshClaim: false,
      });
    });

    /** @scenario "Opening a confirmation link a second time confirms, rather than refusing" */
    it("returns status only without minting a session", async () => {
      const { ctx, createSession } = fakeContext({ token: "spent-token" });

      const answer = await run(ctx);

      expect(createSession).not.toHaveBeenCalled();
      expect(setSessionCookie).not.toHaveBeenCalled();
      expect(answer.body).toMatchObject({
        accountExists: false,
        addressProof: null,
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

      const answer = await endpoint().confirmSignUpAddress(ctx);

      expect(answer).toBeInstanceOf(Response);
      if (!(answer instanceof Response)) {
        throw new Error("Expected the endpoint's HTTP refusal");
      }
      expect(answer.status).toBe(410);
      expect(await answer.json()).toMatchObject({
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
