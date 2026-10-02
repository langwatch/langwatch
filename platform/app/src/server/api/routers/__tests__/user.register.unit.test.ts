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
import { SignUpRestrictedError } from "~/server/auth/errors";
import { EmailAlreadyRegisteredError } from "~/server/users/errors";
import type { NextApiRequest } from "~/types/next-stubs";
import { createInnerTRPCContext } from "../../trpc";
import { userRouter } from "../user";

// The raw env names an IdP; what this route keys off is the RESOLVED provider
// below, so the two can disagree and that is the point of the coercion tests.
vi.mock("../../../../env.mjs", () => ({
  env: {
    NEXTAUTH_PROVIDER: "auth0",
    BASE_HOST: "http://localhost:5560",
    NEXTAUTH_URL: "http://localhost:5560",
  },
}));

const { rateLimitMock } = vi.hoisted(() => ({
  rateLimitMock: vi.fn().mockResolvedValue({ allowed: true }),
}));
vi.mock("~/server/rateLimit", () => ({ rateLimit: rateLimitMock }));

// The tRPC error-audit middleware writes through the real prisma singleton, so
// a mutation that throws here reaches a live client and fails with a Prisma
// validation error that masks the assertion. Shard-order dependent: on its own
// this file passes, batched with a test that initializes the app singleton it
// does not.
vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/server/auth/rate-limit-client-ip", () => ({
  getAuthRateLimitClientIp: vi.fn(() => "198.51.100.11"),
}));

const { resolveAuthProviderMock } = vi.hoisted(() => ({
  resolveAuthProviderMock: vi.fn(),
}));
const { claimAddressProofMock, claimUnconfirmedAddressProofMock } = vi.hoisted(
  () => ({
    claimAddressProofMock: vi.fn(),
    claimUnconfirmedAddressProofMock: vi.fn(),
  }),
);
const { hasEmailProviderMock, isEmailUnconfiguredMock } = vi.hoisted(() => ({
  hasEmailProviderMock: vi.fn(),
  isEmailUnconfiguredMock: vi.fn(),
}));
vi.mock("~/server/mailer/providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/server/mailer/providers")>()),
  hasEmailProvider: hasEmailProviderMock,
  isEmailUnconfigured: isEmailUnconfiguredMock,
}));
const { registerMock } = vi.hoisted(() => ({
  registerMock: vi.fn(),
}));
const { localSignUpDecisionMock } = vi.hoisted(() => ({
  localSignUpDecisionMock: vi.fn(),
}));
const { assertSignUpMock } = vi.hoisted(() => ({
  assertSignUpMock: vi.fn(),
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
  localSignUpDecision: localSignUpDecisionMock,
  signUpPolicy: () => ({ assertSignUp: assertSignUpMock }),
  signUpVerification: () => ({
    claimAddressProof: claimAddressProofMock,
    claimUnconfirmedAddressProof: claimUnconfirmedAddressProofMock,
  }),
}));

vi.mock("@ee/sso/sso-gate", () => ({
  resolveAuthProvider: resolveAuthProviderMock,
}));

vi.mock(
  "~/server/app-layer/authz/permission-adapters",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("~/server/app-layer/authz/permission-adapters")
      >();
    return {
      ...actual,
      skipPermissionCheck: ({ ctx, next }: any) => {
        ctx.permissionChecked = true;
        return next();
      },
    };
  },
);

describe("userRouter.register()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerMock.mockResolvedValue({ id: "user-1" });
    assertSignUpMock.mockResolvedValue(undefined);
    // Most cases here are the coerced/email-mode deployment; the licensed-SSO
    // case overrides this.
    resolveAuthProviderMock.mockResolvedValue("email");
    localSignUpDecisionMock.mockResolvedValue({
      outcome: "enroll",
      methodSet: [{ id: "password", kind: "password", connectionId: null }],
      reasonCode: "identifier_unknown",
    });
    claimAddressProofMock.mockResolvedValue(true);
    claimUnconfirmedAddressProofMock.mockResolvedValue(false);
    hasEmailProviderMock.mockReturnValue(true);
    isEmailUnconfiguredMock.mockReturnValue(false);
  });

  /** A browser request carrying these headers, as the tRPC route hands it on. */
  const requestWith = (headers: Record<string, string>) =>
    ({ headers }) as unknown as NextApiRequest;

  const createCaller = (
    headers: Record<string, string> = { origin: "http://localhost:5560" },
  ) =>
    userRouter.createCaller(
      createInnerTRPCContext({ session: null, req: requestWith(headers) }),
    );

  describe("when the browser is on a web address the installation is not set up for", () => {
    /** @scenario "A sign-up on a web address the installation is not set up for writes no account" */
    it("refuses with the invalid origin code before the proof is spent or the account written", async () => {
      await expect(
        createCaller({ origin: "http://localhost:18560" }).register({
          email: "sam@acme.com",
          password: "correct horse battery staple",
          addressProof: "unconfirmed-proof",
        }),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        cause: { code: "auth_invalid_origin" },
      });

      expect(claimAddressProofMock).not.toHaveBeenCalled();
      expect(claimUnconfirmedAddressProofMock).not.toHaveBeenCalled();
      expect(registerMock).not.toHaveBeenCalled();
    });

    /** @scenario "A sign-up request that names no web address is refused" */
    it("refuses a request carrying neither an origin nor a referer", async () => {
      await expect(
        createCaller({}).register({
          email: "sam@acme.com",
          password: "correct horse battery staple",
          addressProof: "proof-1",
        }),
      ).rejects.toMatchObject({ cause: { code: "auth_invalid_origin" } });
      expect(registerMock).not.toHaveBeenCalled();
    });
  });

  describe("when the installation's sign-up policy refuses the address", () => {
    /** @scenario "A refused registration spends no address proof and writes no account" */
    it("refuses with the restricted code before the proof is spent or the account written", async () => {
      assertSignUpMock.mockRejectedValue(
        new SignUpRestrictedError("invite_only"),
      );

      await expect(
        createCaller().register({
          email: "Stranger@Example.com",
          password: "correct horse battery staple",
          addressProof: "proof-1",
        }),
      ).rejects.toMatchObject({
        cause: { code: "auth_sign_up_restricted" },
      });

      expect(assertSignUpMock).toHaveBeenCalledWith({
        email: "stranger@example.com",
      });
      expect(claimAddressProofMock).not.toHaveBeenCalled();
      expect(claimUnconfirmedAddressProofMock).not.toHaveBeenCalled();
      expect(registerMock).not.toHaveBeenCalled();
    });
  });

  describe("when the browser is on the configured address and sends only a referer", () => {
    it("accepts the sign-up", async () => {
      await expect(
        createCaller({
          referer: "http://localhost:5560/auth/signup",
        }).register({
          email: "sam@acme.com",
          password: "correct horse battery staple",
          addressProof: "proof-1",
        }),
      ).resolves.toEqual({ id: "user-1" });
    });
  });

  describe("when registration succeeds", () => {
    it("answers with the id of the account that was opened", async () => {
      await expect(
        createCaller().register({
          name: "Alice",
          email: "a@x.com",
          password: "supersecret",
          addressProof: "proof-1",
        }),
      ).resolves.toEqual({ id: "user-1" });

      expect(registerMock).toHaveBeenCalledWith({
        name: "Alice",
        email: "a@x.com",
        password: "supersecret",
        addressConfirmed: true,
      });
      expect(rateLimitMock).toHaveBeenCalledWith({
        key: "user.register:198.51.100.11",
        windowSeconds: 60 * 60,
        max: 20,
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
        addressProof: "proof-1",
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
          addressProof: "proof-1",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });

      expect(claimAddressProofMock).toHaveBeenCalled();
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
          addressProof: "proof-1",
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
          addressProof: "proof-1",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(registerMock).not.toHaveBeenCalled();
    });
  });

  describe("when no matching mailbox proof is presented", () => {
    /** @scenario Sign-up proves the address before asking for a credential */
    it("refuses before the credential writer runs", async () => {
      claimAddressProofMock.mockResolvedValue(false);

      await expect(
        createCaller().register({
          email: "sam@acme.com",
          password: "correct horse battery staple",
          name: "Sam",
          addressProof: "spent-or-borrowed",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(registerMock).not.toHaveBeenCalled();
    });
  });

  describe("when the named email provider cannot be used", () => {
    /** @scenario "A misconfigured email provider keeps sign-up on the mailed link" */
    it("refuses an unconfirmed proof without spending it", async () => {
      hasEmailProviderMock.mockReturnValue(false);
      isEmailUnconfiguredMock.mockReturnValue(false);
      claimAddressProofMock.mockResolvedValue(false);
      claimUnconfirmedAddressProofMock.mockResolvedValue(true);

      await expect(
        createCaller().register({
          email: "sam@acme.com",
          password: "correct horse battery staple",
          addressProof: "unconfirmed-proof",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(claimUnconfirmedAddressProofMock).not.toHaveBeenCalled();
      expect(registerMock).not.toHaveBeenCalled();
    });
  });

  describe("when the installation has no email provider", () => {
    beforeEach(() => {
      hasEmailProviderMock.mockReturnValue(false);
      isEmailUnconfiguredMock.mockReturnValue(true);
      claimAddressProofMock.mockResolvedValue(false);
      claimUnconfirmedAddressProofMock.mockResolvedValue(true);
    });

    /** @scenario "An installation that cannot send email signs up with a password and leaves the address unconfirmed" */
    it("spends the unconfirmed proof and opens the account unconfirmed", async () => {
      await expect(
        createCaller().register({
          email: "Sam@Acme.com",
          password: "correct horse battery staple",
          addressProof: "unconfirmed-proof",
        }),
      ).resolves.toEqual({ id: "user-1" });

      expect(claimUnconfirmedAddressProofMock).toHaveBeenCalledWith({
        token: "unconfirmed-proof",
        email: "sam@acme.com",
      });
      expect(registerMock).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "sam@acme.com",
          addressConfirmed: false,
        }),
      );
    });

    it("still opens the account confirmed when a confirmed proof is spent", async () => {
      claimAddressProofMock.mockResolvedValue(true);

      await createCaller().register({
        email: "sam@acme.com",
        password: "correct horse battery staple",
        addressProof: "confirmed-proof",
      });

      expect(claimUnconfirmedAddressProofMock).not.toHaveBeenCalled();
      expect(registerMock).toHaveBeenCalledWith(
        expect.objectContaining({ addressConfirmed: true }),
      );
    });

    it("refuses when neither proof checks out", async () => {
      claimUnconfirmedAddressProofMock.mockResolvedValue(false);

      await expect(
        createCaller().register({
          email: "sam@acme.com",
          password: "correct horse battery staple",
          addressProof: "spent-or-borrowed",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(registerMock).not.toHaveBeenCalled();
    });
  });

  describe("when the installation can send email again", () => {
    /** @scenario "An unconfirmed address proof is refused once the installation can send email" */
    it("refuses an unconfirmed proof without spending it", async () => {
      claimAddressProofMock.mockResolvedValue(false);
      claimUnconfirmedAddressProofMock.mockResolvedValue(true);

      await expect(
        createCaller().register({
          email: "sam@acme.com",
          password: "correct horse battery staple",
          addressProof: "unconfirmed-proof",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(claimUnconfirmedAddressProofMock).not.toHaveBeenCalled();
      expect(registerMock).not.toHaveBeenCalled();
    });
  });

  describe("when the address becomes SSO-routed after proof", () => {
    it("refuses before spending the proof or writing a credential", async () => {
      localSignUpDecisionMock.mockResolvedValue({
        outcome: "redirect",
        methodSet: [],
        reasonCode: "verified_domain",
      });

      await expect(
        createCaller().register({
          email: "sam@acme.com",
          password: "correct horse battery staple",
          name: "Sam",
          addressProof: "still-live",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(claimAddressProofMock).not.toHaveBeenCalled();
      expect(registerMock).not.toHaveBeenCalled();
    });
  });
});
