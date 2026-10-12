/**
 * @vitest-environment node
 *
 * The sign-up screens on an installation whose sign-up policy refuses the
 * address (specs/auth/sign-up-restriction.feature).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "~/env.mjs";
import { SignUpRestrictedError } from "~/server/auth/errors";
import { _resetMemoryRateLimitStore } from "~/server/rateLimit";
import type { NextApiRequest } from "~/types/next-stubs";
import { createInnerTRPCContext } from "../../trpc";
import { authRouter } from "../auth";

const {
  route,
  addressState,
  requestVerification,
  issueUnconfirmedAddressProof,
  validateAddressProof,
  assertSignUp,
  localSignUpDecision,
  hasEmailProvider,
  isEmailUnconfigured,
} = vi.hoisted(() => ({
  route: vi.fn(),
  addressState: vi.fn(),
  requestVerification: vi.fn(),
  issueUnconfirmedAddressProof: vi.fn(),
  validateAddressProof: vi.fn(),
  assertSignUp: vi.fn(),
  localSignUpDecision: vi.fn(),
  hasEmailProvider: vi.fn(),
  isEmailUnconfigured: vi.fn(),
}));

vi.mock("~/server/app-layer/identity/runtime", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/server/app-layer/identity/runtime")
  >()),
  signInRouter: () => ({ route }),
  signUpPolicy: () => ({ assertSignUp }),
  localSignUpDecision,
  signUpVerification: () => ({
    addressState,
    requestVerification,
    issueUnconfirmedAddressProof,
    validateAddressProof,
  }),
}));

vi.mock("~/server/mailer/providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/server/mailer/providers")>()),
  hasEmailProvider,
  isEmailUnconfigured,
}));

vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));

const APP_ORIGIN = new URL(env.NEXTAUTH_URL).origin;

const signedOut = () =>
  authRouter.createCaller(
    createInnerTRPCContext({
      session: null,
      req: { headers: { origin: APP_ORIGIN } } as unknown as NextApiRequest,
    }),
  );

describe("auth router when the sign-up policy refuses the address", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetMemoryRateLimitStore();
    hasEmailProvider.mockReturnValue(true);
    isEmailUnconfigured.mockReturnValue(false);
    route.mockResolvedValue({
      outcome: "route_to_signup",
      methodSet: [],
      reasonCode: "identifier_unknown",
    });
    addressState.mockResolvedValue("unknown");
    requestVerification.mockResolvedValue(void 0);
    validateAddressProof.mockResolvedValue(true);
    localSignUpDecision.mockResolvedValue({
      outcome: "enroll",
      methodSet: [{ id: "password", kind: "password", connectionId: null }],
      reasonCode: "identifier_unknown",
    });
    assertSignUp.mockRejectedValue(new SignUpRestrictedError("invite_only"));
  });

  describe("when the visitor asks for a sign-up confirmation link", () => {
    /** @scenario "A refused sign-up is told before a confirmation link is sent" */
    it("refuses with the restricted code and mails nothing", async () => {
      await expect(
        signedOut().requestSignUpVerification({
          email: "stranger@example.com",
        }),
      ).rejects.toMatchObject({ cause: { code: "auth_sign_up_restricted" } });

      expect(assertSignUp).toHaveBeenCalledWith({
        email: "stranger@example.com",
      });
      expect(requestVerification).not.toHaveBeenCalled();
      expect(issueUnconfirmedAddressProof).not.toHaveBeenCalled();
    });
  });

  describe("when the visitor arrives holding a proof minted before sign-up closed", () => {
    it("refuses the enrollment with the restricted code", async () => {
      await expect(
        signedOut().signUpEnrollment({
          email: "stranger@example.com",
          addressProof: "proof-1",
        }),
      ).rejects.toMatchObject({ cause: { code: "auth_sign_up_restricted" } });
    });

    it("tells a caller holding no valid proof nothing about the policy", async () => {
      validateAddressProof.mockResolvedValue(false);
      await expect(
        signedOut().signUpEnrollment({
          email: "stranger@example.com",
          addressProof: "forged",
        }),
      ).rejects.toMatchObject({
        cause: { code: "auth_no_address_to_confirm" },
      });
      expect(assertSignUp).not.toHaveBeenCalled();
    });
  });

  describe("when an account is already awaiting its confirmation", () => {
    it("sends the link again without asking the policy", async () => {
      addressState.mockResolvedValue("awaiting_confirmation");
      await expect(
        signedOut().requestSignUpVerification({ email: "sam@acme.com" }),
      ).resolves.toEqual({ sent: true });
      expect(assertSignUp).not.toHaveBeenCalled();
    });

    it("sends the enrollment to log in without asking the policy", async () => {
      localSignUpDecision.mockResolvedValue({
        outcome: "existing_account",
        methodSet: [],
        reasonCode: "account_methods",
      });
      await expect(
        signedOut().signUpEnrollment({
          email: "sam@acme.com",
          addressProof: "proof-1",
        }),
      ).resolves.toMatchObject({ outcome: "existing_account" });
      expect(assertSignUp).not.toHaveBeenCalled();
    });
  });

  describe("when the policy admits the address", () => {
    it("mails the link as before", async () => {
      assertSignUp.mockResolvedValue(undefined);
      await expect(
        signedOut().requestSignUpVerification({ email: "sam@acme.com" }),
      ).resolves.toEqual({ sent: true });
      expect(requestVerification).toHaveBeenCalledWith({
        email: "sam@acme.com",
      });
    });
  });
});
