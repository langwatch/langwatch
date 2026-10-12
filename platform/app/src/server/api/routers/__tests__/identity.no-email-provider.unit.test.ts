/**
 * @vitest-environment node
 *
 * The account's own addresses on an installation with no email provider, and
 * the one fact the address list shares with sign-in linking.
 *
 * Spec: specs/identity/authentication-settings.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { _resetMemoryRateLimitStore } from "~/server/rateLimit";
import { createInnerTRPCContext } from "../../trpc";
import { identityRouter } from "../identity";

const {
  addressState,
  listIdentifiers,
  addEmailIdentifier,
  resendConfirmation,
  hasEmailProvider,
} = vi.hoisted(() => ({
  addressState: vi.fn(),
  listIdentifiers: vi.fn(),
  addEmailIdentifier: vi.fn(),
  resendConfirmation: vi.fn(),
  hasEmailProvider: vi.fn(),
}));

vi.mock("~/server/app-layer/identity/runtime", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/server/app-layer/identity/runtime")
  >()),
  signUpVerification: () => ({ addressState }),
  accountIdentifiers: () => ({
    listIdentifiers,
    addEmailIdentifier,
    resendConfirmation,
  }),
}));

vi.mock("~/server/mailer/providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/server/mailer/providers")>()),
  hasEmailProvider,
}));

vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));

/** A well-formed S256 challenge: 43 base64url characters. */
const CHALLENGE = "a".repeat(43);

const signedIn = () =>
  identityRouter.createCaller(
    createInnerTRPCContext({
      session: {
        user: { id: "user-1", email: "sam@acme.com" },
        sessionId: "sess-1",
        expires: "2099-01-01",
      },
    }),
  );

describe("identity router without an email provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetMemoryRateLimitStore();
    hasEmailProvider.mockReturnValue(false);
    listIdentifiers.mockResolvedValue([]);
    addEmailIdentifier.mockResolvedValue({ identifierId: "idf_new" });
    resendConfirmation.mockResolvedValue(undefined);
  });

  describe("when an address is added", () => {
    /** @scenario "Adding or resending an address without a way to send email is refused with a named error" */
    it("refuses with a named error and attaches nothing", async () => {
      await expect(
        signedIn().addEmailIdentifier({
          email: "sam@other.com",
          codeChallenge: CHALLENGE,
        }),
      ).rejects.toMatchObject({
        cause: { code: "auth_email_sending_unavailable" },
      });
      expect(addEmailIdentifier).not.toHaveBeenCalled();
    });
  });

  describe("when an address is sent its link again", () => {
    /** @scenario "Adding or resending an address without a way to send email is refused with a named error" */
    it("refuses with a named error and sends nothing", async () => {
      await expect(
        signedIn().resendIdentifierConfirmation({
          identifierId: "idf_other",
          codeChallenge: CHALLENGE,
        }),
      ).rejects.toMatchObject({
        cause: { code: "auth_email_sending_unavailable" },
      });
      expect(resendConfirmation).not.toHaveBeenCalled();
    });
  });

  describe("when a provider is configured", () => {
    beforeEach(() => {
      hasEmailProvider.mockReturnValue(true);
    });

    it("adds the address as before", async () => {
      await expect(
        signedIn().addEmailIdentifier({
          email: "sam@other.com",
          codeChallenge: CHALLENGE,
        }),
      ).resolves.toEqual({ identifierId: "idf_new" });
      expect(addEmailIdentifier).toHaveBeenCalledWith({
        userId: "user-1",
        email: "sam@other.com",
        codeChallenge: CHALLENGE,
      });
    });
  });

  describe("when the addresses are listed", () => {
    /** @scenario "The account's own address confirmed outside the app shows as confirmed" */
    it("hands the list the account's own confirmation, read the way sign-in reads it", async () => {
      addressState.mockResolvedValue("confirmed");

      await signedIn().myIdentifiers({});

      expect(addressState).toHaveBeenCalledWith({ email: "sam@acme.com" });
      expect(listIdentifiers).toHaveBeenCalledWith({
        userId: "user-1",
        accountAddress: { email: "sam@acme.com", confirmed: true },
      });
    });

    /** @scenario "The account's own address confirmed outside the app shows as confirmed" */
    it("says the own address is unconfirmed while the account still waits on it", async () => {
      addressState.mockResolvedValue("awaiting_confirmation");

      await signedIn().myIdentifiers({});

      expect(listIdentifiers).toHaveBeenCalledWith({
        userId: "user-1",
        accountAddress: { email: "sam@acme.com", confirmed: false },
      });
    });
  });
});
