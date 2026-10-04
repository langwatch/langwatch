/**
 * @vitest-environment node
 * Error message copy for better-auth and platform failures; registry in front-door-error-copy.ts
 */
import { describe, expect, it } from "vitest";

import { authFailureMessage } from "../auth-failure-message.ts";
import { frontDoorErrorCopy } from "../front-door-error-copy.ts";

const registryCopy = (code: string): string => {
  const explanation = frontDoorErrorCopy({
    code,
    httpStatus: 500,
    meta: {},
    tips: [],
    traceId: undefined,
  });
  if (!explanation) throw new Error(`No registered copy for ${code}`);
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
      expect(message).not.toBe("Sign in did not go through. Please try again.");
    });

    it("renders the registry's copy for a 503 rather than the generic server-side line", () => {
      const message = authFailureMessage({
        code: "identity_engine_unavailable",
        message: "identity_engine_unavailable",
        status: 503,
      });

      expect(message).toContain(registryCopy("identity_engine_unavailable"));
      expect(message).not.toBe("Something went wrong on our side. Try again in a moment.");
    });

    it("reads an upper-cased code the same way, because the wire shape varies", () => {
      expect(authFailureMessage({ code: "IDENTITY_EMAIL_IN_USE", status: 409 })).toContain(
        registryCopy("identity_email_in_use"),
      );
    });
  });

  describe("when the response carries one of better-auth's own identifiers", () => {
    it("keeps this module's wording, which the registry has no entry for", () => {
      expect(authFailureMessage({ code: "INVALID_ORIGIN", status: 403 })).toBe(
        "LangWatch is set up for a different web address than the one you are using. Check the address and try again.",
      );
      expect(authFailureMessage({ code: "INVALID_EMAIL_OR_PASSWORD", status: 401 })).toBe(
        "Invalid email or password.",
      );
    });
  });

  describe("when the installation has stopped accepting attempts", () => {
    /** @scenario Too many attempts says to wait */
    it("tells the person to wait, whether the refusal came as a status or a code", () => {
      const byStatus = authFailureMessage({ message: "Too many requests", status: 429 });
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

    /** @scenario "A sign-up on a web address the installation is not set up for writes no account" */
    it("reads the same for the sign-up procedures' own refusal", () => {
      expect(authFailureMessage({ code: "auth_invalid_origin" })).toBe(
        authFailureMessage({ code: "INVALID_ORIGIN" }),
      );
    });
  });

  describe("when the installation restricts sign-up", () => {
    /** @scenario "A refused sign-up reads that sign-up is by invitation" */
    it("says sign-up is by invitation, and never that something broke", () => {
      const message = authFailureMessage({
        code: "auth_sign_up_restricted",
        message: "auth_sign_up_restricted",
        status: 403,
      });

      expect(registryCopy("auth_sign_up_restricted")).toBe(
        "Sign-up on this installation is by invitation",
      );
      expect(message).toContain("Sign-up on this installation is by invitation");
      expect(message).toMatch(/administrator to invite/);
      expect(message).not.toContain("auth_sign_up_restricted");
    });
  });

  describe("when nothing recognizable comes back", () => {
    /** @scenario An unexpected failure still says something honest */
    it("falls back rather than putting an identifier on screen", () => {
      const message = authFailureMessage({
        code: "SOME_NEW_CODE",
        message: "SOME_NEW_CODE",
        status: 400,
      });

      expect(message).toBe("Sign in did not go through. Please try again.");
      expect(message).not.toContain("SOME_NEW_CODE");
    });
  });
});
