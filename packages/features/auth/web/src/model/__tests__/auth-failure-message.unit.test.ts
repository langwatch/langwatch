/**
 * @vitest-environment node
 *
 * The words a customer reads when sign-in or sign-up fails.
 *
 * Two vocabularies answer this endpoint and only one of them is ours.
 * better-auth's own identifiers have no handled-error registry entry, so their
 * wording is written here; every platform refusal carries a stable `code` and
 * has to read from the code-keyed error registry, which is where every other
 * surface gets its words. The registry copy shipped with the identity adapter
 * is only reachable on THIS path, so a surface that did not consult it would
 * leave that copy dead.
 *
 * WHAT THE MOVE CHANGED, AND WHAT IT DID NOT. In `platform/app` these cases
 * drove `explainHandledError` — the application's whole ~90-code registry. A
 * feature-web package may not import it, so the front door's own entries were
 * harvested verbatim into `model/front-door-error-copy.ts` and the registry is
 * reached through an installable seam. The assertions still read the copy out
 * of the registry rather than restating it, which is the property that kept
 * this file honest: a title changed in one place and not the other fails here.
 *
 * Corresponds to specs/identity/identity-storage-adapter.feature.
 */
import { describe, expect, it } from "vitest";
import { authFailureMessage } from "../auth-failure-message";
import { frontDoorErrorCopy } from "../front-door-error-copy";

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

  describe("when the response carries one of better-auth's own identifiers", () => {
    it("keeps this module's wording, which the registry has no entry for", () => {
      expect(authFailureMessage({ code: "INVALID_ORIGIN", status: 403 })).toBe(
        "LangWatch is set up for a different web address than the one you are using. Check the address and try again.",
      );
      expect(
        authFailureMessage({ code: "INVALID_EMAIL_OR_PASSWORD", status: 401 }),
      ).toBe("Invalid email or password.");
    });
  });

  describe("when nothing recognizable comes back", () => {
    it("falls back rather than putting an identifier on screen", () => {
      expect(authFailureMessage({ code: "SOME_NEW_CODE", status: 400 })).toBe(
        "Sign in did not go through. Please try again.",
      );
    });
  });
});
