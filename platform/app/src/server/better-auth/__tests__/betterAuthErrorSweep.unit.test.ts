import { describe, expect, it } from "vitest";
import { readHandledError } from "~/features/errors";
import { isCredentialRejection } from "~/pages/auth/authFailureMessage";
import {
  handledErrorForBetterAuthCode,
  translateBetterAuthError,
} from "../handled-errors";

/**
 * What the sign-in, sign-up, reset, verification and passkey endpoints say
 * when they refuse.
 *
 * The two-factor family has its own file; this one covers the families the
 * sweep added, and it is mostly about the things that must NOT happen:
 *
 *   - a code that means different things on different paths must not be
 *     answered the same way on both;
 *   - a wrong password and an address nobody holds must stay one refusal;
 *   - the reset-REQUEST endpoint must stay untranslated, because it answers
 *     identically whether or not the address has an account;
 *   - anything we cannot name must pass through byte for byte.
 */

function refusal({
  code,
  status = 400,
}: {
  code: string;
  status?: number;
}): Response {
  return new Response(JSON.stringify({ code, message: "…" }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

const translate = ({
  code,
  path,
  status,
}: {
  code: string;
  path: string;
  status?: number;
}) => translateBetterAuthError({ response: refusal({ code, status }), path });

describe("the sign-in, sign-up, reset and passkey refusals", () => {
  describe("given a credential sign-in that did not check out", () => {
    describe("when the endpoint refuses it", () => {
      /**
       * The half of the no-oracle that ADR-117's 2026-08-25 revision did NOT
       * retire, and the reason retiring the other half is safe. The router
       * will now tell anybody whether an address has an account; what is still
       * never told is which half of a submitted PAIR was wrong, because that
       * is what turns credential stuffing from guessing pairs into guessing
       * one field at a time.
       */
      /** @scenario A refused credential still refuses in one way */
      /** @scenario A wrong password says the password is wrong */
      it("answers one code, whatever the reason underneath was", async () => {
        const body = await translate({
          code: "INVALID_EMAIL_OR_PASSWORD",
          path: "/api/auth/sign-in/email",
          status: 401,
        }).then(bodyOf);

        expect(body.error).toBe("identity_sign_in_refused");
      });

      /** @scenario A wrong password says the password is wrong */
      it("is still read as a credential rejection, so the funnel keeps working", () => {
        // The unified funnel converts an address nobody holds into a sign-up,
        // and it decides that from this answer. Translating the code without
        // teaching the reader about it would silently stop the conversion —
        // and the two situations would stop being indistinguishable, which is
        // the property the translation is supposed to preserve.
        expect(
          isCredentialRejection({ code: "identity_sign_in_refused" }),
        ).toBe(true);
        expect(
          isCredentialRejection({ code: "INVALID_EMAIL_OR_PASSWORD" }),
        ).toBe(true);
      });

      /** @scenario An unexpected failure still says something honest */
      it("never puts the endpoint's own sentence where copy belongs", async () => {
        const body = await translate({
          code: "INVALID_EMAIL_OR_PASSWORD",
          path: "/api/auth/sign-in/email",
          status: 401,
        }).then(bodyOf);

        // The wire message for a handled refusal IS the code; the words a
        // customer reads come from the registry, keyed by it.
        expect(readHandledError(body)?.code).toBe("identity_sign_in_refused");
        expect(body.message).not.toContain("…");
      });
    });
  });

  describe("given a sign-up", () => {
    describe("when the address already has an account", () => {
      /** @scenario Sign-up failures read the same way */
      it("says so, because that refusal is the door back into a half-made account", async () => {
        const body = await translate({
          code: "USER_ALREADY_EXISTS",
          path: "/api/auth/sign-up/email",
          status: 409,
        }).then(bodyOf);

        expect(body.error).toBe("email_already_registered");
      });
    });

    describe("when the password is refused on policy", () => {
      /** @scenario Sign-up failures read the same way */
      it("names the password rather than the account", async () => {
        const body = await translate({
          code: "PASSWORD_TOO_SHORT",
          path: "/api/auth/sign-up/email",
        }).then(bodyOf);

        expect(body.error).toBe("identity_password_rejected");
      });
    });
  });

  describe("given the two token families", () => {
    describe("when the same code arrives on each", () => {
      /** @scenario A refused reset says why in words from the registry */
      it("answers a dead reset link and an unusable confirmation differently", async () => {
        const [reset, verification] = await Promise.all([
          translate({
            code: "INVALID_TOKEN",
            path: "/api/auth/reset-password",
          }).then(bodyOf),
          translate({
            code: "INVALID_TOKEN",
            path: "/api/auth/verify-email",
          }).then(bodyOf),
        ]);

        // The whole reason the table is keyed by path as well as code: the
        // remedies are different sentences, and one of them would send
        // somebody to the wrong inbox.
        expect(reset.error).toBe("identity_reset_link_invalid");
        expect(verification.error).toBe("identity_verification_invalid");
      });

      /** @scenario A refused reset says why in words from the registry */
      it("collapses expired, spent and never-issued into one reset answer", async () => {
        const [expired, invalid] = await Promise.all([
          translate({
            code: "TOKEN_EXPIRED",
            path: "/api/auth/reset-password",
          }).then(bodyOf),
          translate({
            code: "INVALID_TOKEN",
            path: "/api/auth/reset-password",
          }).then(bodyOf),
        ]);

        // Telling them apart would say whether a link had ever existed and
        // whether it had been opened. The way forward is the same for all
        // three.
        expect(expired).toEqual(invalid);
      });
    });
  });

  describe("given the endpoint that must never be an oracle", () => {
    describe("when a reset is requested for any address at all", () => {
      /** @scenario Requesting a reset always shows a neutral confirmation */
      it("is not a translated path, so nothing about it can be named", async () => {
        const original = refusal({ code: "USER_NOT_FOUND", status: 400 });
        const translated = await translateBetterAuthError({
          response: original,
          path: "/api/auth/request-password-reset",
        });

        expect(translated).toBe(original);
      });
    });
  });

  describe("given a passkey", () => {
    describe("when the credential is one we will not accept", () => {
      /** @scenario A passkey nobody holds is refused without telling anyone anything */
      it("answers the same whether it belongs to somebody else or to nobody", async () => {
        const [unknown, failed] = await Promise.all([
          translate({
            code: "PASSKEY_NOT_FOUND",
            path: "/api/auth/passkey/verify-authentication",
          }).then(bodyOf),
          translate({
            code: "AUTHENTICATION_FAILED",
            path: "/api/auth/passkey/verify-authentication",
          }).then(bodyOf),
        ]);

        expect(unknown.error).toBe("identity_passkey_not_recognized");
        expect(unknown).toEqual(failed);
      });
    });

    describe("when the ceremony itself did not complete", () => {
      /** @scenario A ceremony that does not complete leaves nothing behind */
      it("carries the ceremony code rather than the credential one", async () => {
        const body = await translate({
          code: "CHALLENGE_NOT_FOUND",
          path: "/api/auth/passkey/verify-registration",
        }).then(bodyOf);

        expect(body.error).toBe("identity_passkey_ceremony_failed");
      });
    });

    describe("when the authenticator offers one the account already holds", () => {
      /** @scenario Registering the same passkey twice does not make a second one */
      it("says it is already there rather than reporting a failed attempt", async () => {
        const body = await translate({
          code: "PREVIOUSLY_REGISTERED",
          path: "/api/auth/passkey/verify-registration",
          status: 409,
        }).then(bodyOf);

        expect(body.error).toBe("identity_passkey_already_registered");
      });
    });

    describe("when our own sign-up refusal rides the passkey path", () => {
      /** @scenario A passkey is never registered against an address that already has an account */
      it("passes through untouched, because the sign-up screen watches for it", async () => {
        const original = refusal({
          code: "EMAIL_ALREADY_REGISTERED",
          status: 409,
        });
        const translated = await translateBetterAuthError({
          response: original,
          path: "/api/auth/passkey/generate-register-options",
        });

        // Translating it would break the conversion it exists for: the screen
        // becomes the log-in one with the address already in it.
        expect(translated).toBe(original);
      });
    });
  });

  describe("given a failure nothing anticipated", () => {
    describe("when it arrives on a translated path", () => {
      /** @scenario A failure we cannot name stays unnamed */
      it("passes through byte for byte rather than getting a code invented for it", async () => {
        const original = refusal({
          code: "SOME_FUTURE_BETTER_AUTH_FAILURE",
          status: 500,
        });
        const translated = await translateBetterAuthError({
          response: original,
          path: "/api/auth/sign-in/email",
        });

        expect(translated).toBe(original);
        expect(
          handledErrorForBetterAuthCode({
            code: "SOME_FUTURE_BETTER_AUTH_FAILURE",
            path: "/api/auth/sign-in/email",
            detail: "…",
          }),
        ).toBeNull();
      });

      /** @scenario A failure we cannot name stays unnamed */
      it("stays unnamed even where the same code IS named on another family", () => {
        // `INVALID_TOKEN` is named on the reset and verification paths and on
        // neither of the others. A code is only ever meaningful inside its
        // family, and the lookup says so.
        expect(
          handledErrorForBetterAuthCode({
            code: "INVALID_TOKEN",
            path: "/api/auth/sign-in/email",
            detail: "…",
          }),
        ).toBeNull();
        expect(
          handledErrorForBetterAuthCode({
            code: "INVALID_CODE",
            path: "/api/auth/passkey/verify-authentication",
            detail: "…",
          }),
        ).toBeNull();
      });
    });
  });
});
