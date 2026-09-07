/**
 * Unit tests for userRouter.register.
 *
 * Covers the ADR-027 provider coercion (see
 * specs/licensing/sso-license-gating.feature) and the confirmation link the
 * account-creating call sends. The signup page registers through this tRPC
 * mutation (not better-auth's /sign-up/email), so the email-mode coercion must
 * apply here too: on a denied SSO-capable deployment the resolved provider is
 * "email" and registration must work, while a licensed SSO deployment keeps
 * refusing direct registration.
 *
 * Opening the account itself — the duplicate-address refusal, the hash, the
 * credential identifier and the sign-up milestone — is
 * `CredentialAccountService`'s, and its own test drives them over fakes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmailAlreadyRegisteredError } from "~/server/users/errors";
import { createInnerTRPCContext } from "../../trpc";
import { userRouter } from "../user";

// The raw env names an IdP; what this route keys off is the RESOLVED provider
// below, so the two can disagree and that is the point of the coercion tests.
vi.mock("../../../../env.mjs", () => ({
  env: { NEXTAUTH_PROVIDER: "auth0", BASE_HOST: "http://localhost:5560" },
}));

vi.mock("~/server/rateLimit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

// The tRPC error-audit middleware writes through the real prisma singleton, so
// a mutation that throws here reaches a live client and fails with a Prisma
// validation error that masks the assertion. Shard-order dependent: on its own
// this file passes, batched with a test that initializes the app singleton it
// does not.
vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/utils/getClientIp", () => ({
  getDirectPeerIp: vi.fn(() => "127.0.0.1"),
}));

const { resolveAuthProviderMock } = vi.hoisted(() => ({
  resolveAuthProviderMock: vi.fn(),
}));
const { requestVerificationMock } = vi.hoisted(() => ({
  requestVerificationMock: vi.fn(),
}));
const { registerMock } = vi.hoisted(() => ({
  registerMock: vi.fn(),
}));

// The account-creating call is what sends the confirmation link, so the two
// services it drives are the seam this suite reads. The verification service's
// other two methods answer "no proof was carried in", which is the plain
// sign-up path.
vi.mock("~/server/app-layer/identity/runtime", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/server/app-layer/identity/runtime")
  >()),
  credentialAccounts: () => ({ register: registerMock }),
  signUpVerification: () => ({
    claimAddressProof: vi.fn().mockResolvedValue(null),
    markAddressConfirmed: vi.fn().mockResolvedValue(undefined),
    requestVerification: requestVerificationMock,
  }),
}));

vi.mock("@ee/sso/sso-gate", () => ({
  resolveAuthProvider: resolveAuthProviderMock,
}));

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    skipPermissionCheck: ({ ctx, next }: any) => {
      ctx.permissionChecked = true;
      return next();
    },
  };
});

describe("userRouter.register()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerMock.mockResolvedValue({ id: "user-1" });
    // Most cases here are the coerced/email-mode deployment; the licensed-SSO
    // case overrides this.
    resolveAuthProviderMock.mockResolvedValue("email");
    requestVerificationMock.mockResolvedValue(undefined);
  });

  const createCaller = () =>
    userRouter.createCaller(createInnerTRPCContext({ session: null }));

  describe("when registration succeeds", () => {
    it("answers with the id of the account that was opened", async () => {
      await expect(
        createCaller().register({
          name: "Alice",
          email: "a@x.com",
          password: "supersecret",
        }),
      ).resolves.toEqual({ id: "user-1" });

      expect(registerMock).toHaveBeenCalledWith({
        name: "Alice",
        email: "a@x.com",
        password: "supersecret",
      });
    });
  });

  describe("when the email is typed with capital letters", () => {
    /**
     * Sign-in goes through BetterAuth, which lowercases the address on every
     * lookup, so an account stored as typed is one sign-in can never find:
     * the customer is locked out with "User already exists" forever.
     */
    /** @scenario "A capitalised email creates an account sign-in can find" */
    it("hands on the canonically normalized address", async () => {
      await createCaller().register({
        name: "Joel",
        email: "Joel.During@example.com",
        password: "supersecret",
      });

      expect(registerMock).toHaveBeenCalledWith(
        expect.objectContaining({ email: "joel.during@example.com" }),
      );
    });
  });

  describe("when the user already exists", () => {
    it("surfaces the handled refusal the signup screen keys its recovery on", async () => {
      registerMock.mockRejectedValue(new EmailAlreadyRegisteredError());

      // The refusal is the handled email_already_registered error (the signup
      // screen keys its recovery flow off this code), surfaced through tRPC
      // with the CONFLICT transport code its 409 maps to.
      await expect(
        createCaller().register({
          name: "Alice",
          email: "a@x.com",
          password: "supersecret",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });

      expect(requestVerificationMock).not.toHaveBeenCalled();
    });
  });

  describe("given an SSO-capable deployment where the gate DENIES (coerced email mode)", () => {
    /** @scenario A fresh unlicensed deployment bootstraps via email signup */
    it("registers the user through the signup form's tRPC path", async () => {
      resolveAuthProviderMock.mockResolvedValue("email");

      await expect(
        createCaller().register({
          name: "Operator",
          email: "operator@example.com",
          password: "password-123",
        }),
      ).resolves.toMatchObject({ id: "user-1" });
      expect(registerMock).toHaveBeenCalled();
    });
  });

  describe("given an SSO-capable deployment where the gate ALLOWS", () => {
    /** @scenario A licensed deployment cannot mint password accounts */
    it("refuses direct registration", async () => {
      resolveAuthProviderMock.mockResolvedValue("auth0");

      await expect(
        createCaller().register({
          name: "Attacker",
          email: "attacker@example.com",
          password: "password-123",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(registerMock).not.toHaveBeenCalled();
    });
  });

  describe("when the account has just been created", () => {
    /** @scenario "The confirmation link is sent by the call that creates the account" */
    it("sends the link to the address the account was created for", async () => {
      const caller = createCaller();

      await caller.register({
        email: "sam@acme.com",
        password: "correct horse battery staple",
        name: "Sam",
      });

      // Not from the screen, which holds no session to send from, and not
      // from a public "mail this address" endpoint, which would be a mailer
      // pointed at anything anybody types.
      expect(requestVerificationMock).toHaveBeenCalledWith({
        email: "sam@acme.com",
      });
    });

    /** @scenario "The confirmation link is sent by the call that creates the account" */
    it("keeps the account when the mailer is down", async () => {
      requestVerificationMock.mockRejectedValue(new Error("smtp unreachable"));
      const caller = createCaller();

      // The account exists and the way on is the "send it again" the next
      // screen offers; losing the registration over a mail failure would cost
      // somebody the account they just made.
      await expect(
        caller.register({
          email: "sam@acme.com",
          password: "correct horse battery staple",
          name: "Sam",
        }),
      ).resolves.toEqual({ id: "user-1" });
    });
  });
});
