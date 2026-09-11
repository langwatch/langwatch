/**
 * @vitest-environment node
 *
 * The words a customer reads when sign-in or sign-up fails.
 *
 * Two vocabularies answer this endpoint and only one of them is ours.
 * better-auth's own identifiers have no handled-error registry entry, so their
 * wording is written here; every platform refusal carries a stable `code` and
 * has to read from the client presentation registry, which is where every
 * other surface gets its words. The registry copy shipped with the identity
 * adapter is only reachable on THIS path, so a surface that did not consult it
 * would leave that copy dead.
 *
 * Corresponds to specs/auth/sign-in-failure-messages.feature and
 * specs/identity/identity-storage-adapter.feature.
 */
import { describe, expect, it } from "vitest";
import { explainHandledError } from "~/features/errors/logic/presentation";
import { authFailureMessage } from "../authFailureMessage";

const GENERIC = "Sign in did not go through. Please try again.";

const registryCopy = (code: string): string => {
  const explanation = explainHandledError({
    code,
    meta: {},
    httpStatus: 500,
    fault: "platform",
    tips: [],
    docsUrl: undefined,
    traceId: undefined,
    reasons: [],
  });
  return explanation.title;
};

describe("authFailureMessage", () => {
  describe("when the response carries a platform error code", () => {
    /** @scenario "The sign-in screen renders a platform refusal from the registry" */
    it("renders the registry's copy for identity_email_in_use", () => {
      const message = authFailureMessage({
        code: "identity_email_in_use",
        message: "identity_email_in_use",
        status: 409,
      });

      expect(message).toContain(registryCopy("identity_email_in_use"));
      expect(message).not.toContain("identity_email_in_use");
      expect(message).not.toBe(GENERIC);
    });

    it("renders the registry's copy for a 503 rather than the generic server-side line", () => {
      const message = authFailureMessage({
        code: "identity_verification_not_settled",
        message: "identity_verification_not_settled",
        status: 503,
      });

      expect(message).toContain(
        registryCopy("identity_verification_not_settled"),
      );
      expect(message).not.toBe(
        "Something went wrong on our side. Try again in a moment.",
      );
    });

    it("reads an upper-cased code the same way, because the wire shape varies", () => {
      expect(
        authFailureMessage({ code: "IDENTITY_EMAIL_IN_USE", status: 409 }),
      ).toContain(registryCopy("identity_email_in_use"));
    });
  });

  describe("when the credentials are not the account's", () => {
    it("says so in one sentence, whichever spelling the auth layer used", () => {
      expect(
        authFailureMessage({ code: "INVALID_EMAIL_OR_PASSWORD", status: 401 }),
      ).toBe("Invalid email or password.");
      // An address with no account must read exactly like a wrong password,
      // or the difference tells a stranger which addresses have accounts.
      expect(authFailureMessage({ code: "USER_NOT_FOUND", status: 401 })).toBe(
        "Invalid email or password.",
      );
    });
  });

  describe("when the installation has stopped accepting attempts", () => {
    /** @scenario Too many attempts says to wait */
    it("tells the person to wait, whether the refusal came as a status or a code", () => {
      const byStatus = authFailureMessage({
        message: "Too many requests",
        status: 429,
      });
      const byCode = authFailureMessage({ code: "TOO_MANY_ATTEMPTS" });

      expect(byStatus).toMatch(/wait/i);
      expect(byCode).toBe(byStatus);
      expect(byStatus).not.toContain("429");
      expect(byStatus).not.toContain("TOO_MANY");
    });
  });

  describe("when the installation is set up for another address", () => {
    /** @scenario An address mismatch says which thing to check */
    it("names the address as the thing to check, and never the code", () => {
      const message = authFailureMessage({
        code: "INVALID_ORIGIN",
        message: "Invalid origin",
        status: 403,
      });

      expect(message).toBe(
        "LangWatch is set up for a different web address than the one you are using. Check the address and try again.",
      );
      expect(message).not.toContain("INVALID_ORIGIN");
      expect(message).not.toMatch(/origin/i);
    });
  });

  describe("when nothing recognizable comes back", () => {
    /** @scenario An unexpected failure still says something honest */
    it("says the sign-in did not go through rather than putting an identifier on screen", () => {
      const message = authFailureMessage({
        code: "SOME_NEW_CODE",
        message: "SOME_NEW_CODE",
        status: 400,
      });

      expect(message).toBe(GENERIC);
      expect(message).not.toContain("SOME_NEW_CODE");
    });

    it("keeps a real sentence the auth layer wrote for a person", () => {
      expect(
        authFailureMessage({ message: "Password is too short", status: 400 }),
      ).toBe("Password is too short.");
    });
  });
});
