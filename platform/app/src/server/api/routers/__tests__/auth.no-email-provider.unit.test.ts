/**
 * @vitest-environment node
 *
 * Sign-up and the address confirmation nudge on an installation with no email
 * provider (ADR-117, revision 2026-09-25).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { _resetMemoryRateLimitStore } from "~/server/rateLimit";
import { createInnerTRPCContext } from "../../trpc";
import { authRouter } from "../auth";

const {
  route,
  addressState,
  requestVerification,
  issueUnconfirmedAddressProof,
  hasEmailProvider,
} = vi.hoisted(() => ({
  route: vi.fn(),
  addressState: vi.fn(),
  requestVerification: vi.fn(),
  issueUnconfirmedAddressProof: vi.fn(),
  hasEmailProvider: vi.fn(),
}));

vi.mock("~/server/app-layer/identity/runtime", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/server/app-layer/identity/runtime")
  >()),
  signInRouter: () => ({ route }),
  signUpVerification: () => ({
    addressState,
    requestVerification,
    issueUnconfirmedAddressProof,
  }),
}));

vi.mock("~/server/mailer/providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/server/mailer/providers")>()),
  hasEmailProvider,
}));

vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));

const signedOut = () =>
  authRouter.createCaller(createInnerTRPCContext({ session: null }));

const signedIn = () =>
  authRouter.createCaller(
    createInnerTRPCContext({
      session: {
        user: { id: "user-1", email: "sam@acme.com" },
        sessionId: "sess-1",
        expires: "2099-01-01",
      },
    }),
  );

describe("auth router without an email provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetMemoryRateLimitStore();
    hasEmailProvider.mockReturnValue(false);
    route.mockResolvedValue({
      outcome: "sign_up",
      methodSet: [],
      reasonCode: "identifier_unknown",
    });
    addressState.mockResolvedValue("unknown");
    requestVerification.mockResolvedValue(void 0);
    issueUnconfirmedAddressProof.mockResolvedValue("unconfirmed-proof");
  });

  describe("when sign-up asks for a confirmation link", () => {
    /** @scenario "An installation that cannot send email signs up with a password and leaves the address unconfirmed" */
    it("mails nothing and answers with an unconfirmed proof", async () => {
      await expect(
        signedOut().requestSignUpVerification({ email: "sam@acme.com" }),
      ).resolves.toEqual({ sent: false, addressProof: "unconfirmed-proof" });

      expect(requestVerification).not.toHaveBeenCalled();
      expect(issueUnconfirmedAddressProof).toHaveBeenCalledWith({
        email: "sam@acme.com",
      });
    });

    it("sends an address that already has an account to log in", async () => {
      addressState.mockResolvedValue("awaiting_confirmation");

      await expect(
        signedOut().requestSignUpVerification({ email: "sam@acme.com" }),
      ).rejects.toMatchObject({ cause: { code: "email_already_registered" } });
      expect(issueUnconfirmedAddressProof).not.toHaveBeenCalled();
    });

    it("still refuses a domain an organization manages", async () => {
      route.mockResolvedValue({
        outcome: "redirect_to_connection",
        methodSet: [],
        reasonCode: "domain_routed",
      });

      await expect(
        signedOut().requestSignUpVerification({ email: "sam@acme.com" }),
      ).rejects.toMatchObject({
        cause: { code: "auth_direct_registration_unavailable" },
      });
      expect(issueUnconfirmedAddressProof).not.toHaveBeenCalled();
    });

    it("mails the link as before once a provider is configured", async () => {
      hasEmailProvider.mockReturnValue(true);

      await expect(
        signedOut().requestSignUpVerification({ email: "sam@acme.com" }),
      ).resolves.toEqual({ sent: true });
      expect(requestVerification).toHaveBeenCalledWith({
        email: "sam@acme.com",
      });
      expect(issueUnconfirmedAddressProof).not.toHaveBeenCalled();
    });
  });

  describe("when a signed-in account reads or resends its confirmation", () => {
    /** @scenario "Without a way to send email, the address confirmation nudge stays silent" */
    it("says the installation cannot send one", async () => {
      addressState.mockResolvedValue("awaiting_confirmation");

      await expect(signedIn().myAddressConfirmation()).resolves.toEqual({
        email: "sam@acme.com",
        confirmed: false,
        canSendConfirmation: false,
      });
    });

    /** @scenario "Without a way to send email, the address confirmation nudge stays silent" */
    it("refuses to send with a named error instead of failing", async () => {
      await expect(
        signedIn().sendMyAddressConfirmation({}),
      ).rejects.toMatchObject({
        cause: { code: "auth_email_sending_unavailable" },
      });
      expect(requestVerification).not.toHaveBeenCalled();
    });
  });
});
