import { describe, expect, it } from "vitest";
import {
  readHandledError,
  resolveErrorCopy,
  UNKNOWN_ERROR_PRESENTATION,
} from "~/features/errors";
import {
  handledErrorForBetterAuthCode,
  translateBetterAuthError,
} from "../handled-errors";

/**
 * What the two-factor endpoints say when they refuse.
 *
 * Everything here is about the boundary: better-auth's own vocabulary going
 * in, our handled-error contract coming out, and — just as load-bearing —
 * nothing coming out at all for a cause we cannot name.
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

describe("the two-factor endpoints' refusals", () => {
  describe("given sam is locked out after repeated wrong codes", () => {
    describe("when sam enters a valid, unused backup code", () => {
      /** @scenario Backup codes are locked out with everything else */
      it("refuses it as the lockout, not as a wrong code", async () => {
        const translated = await translateBetterAuthError({
          response: refusal({
            code: "ACCOUNT_TEMPORARILY_LOCKED",
            status: 429,
          }),
          path: "/api/auth/two-factor/verify-backup-code",
        });

        const body = await bodyOf(translated);
        expect(body.error).toBe("identity_mfa_locked_out");
        // Never the code refusal: a person told "that code didn't work" about
        // a code that is perfectly good goes and burns the next one.
        expect(body.error).not.toBe("identity_mfa_code_invalid");
        expect(translated.status).toBe(429);
      });

      /** @scenario Backup codes are locked out with everything else */
      it("refuses it exactly the way the authenticator code is refused", async () => {
        const [backupCode, authenticatorCode] = await Promise.all([
          translateBetterAuthError({
            response: refusal({
              code: "ACCOUNT_TEMPORARILY_LOCKED",
              status: 429,
            }),
            path: "/api/auth/two-factor/verify-backup-code",
          }).then(bodyOf),
          translateBetterAuthError({
            response: refusal({
              code: "ACCOUNT_TEMPORARILY_LOCKED",
              status: 429,
            }),
            path: "/api/auth/two-factor/verify-totp",
          }).then(bodyOf),
        ]);

        // The lockout is the person's, not the method's. A backup code that
        // still worked during a lockout would be the way around the lockout.
        expect(backupCode).toEqual(authenticatorCode);
      });

      /** @scenario Backup codes are locked out with everything else */
      it("leaves the code unused, and trying again shortens nothing", async () => {
        const attempts = await Promise.all(
          [1, 2, 3].map(() =>
            translateBetterAuthError({
              response: refusal({
                code: "ACCOUNT_TEMPORARILY_LOCKED",
                status: 429,
              }),
              path: "/api/auth/two-factor/verify-backup-code",
            }).then(bodyOf),
          ),
        );

        // Byte-identical, every time: this boundary holds no state, spends no
        // code and moves no clock. The position a backup code occupies is
        // only ever spent by a consumption, and a refusal is not one.
        expect(attempts[1]).toEqual(attempts[0]);
        expect(attempts[2]).toEqual(attempts[0]);
      });
    });
  });

  describe("given a wrong code of either kind", () => {
    /** @scenario Backup codes are locked out with everything else */
    it("collapses both to one refusal, so the endpoint is no oracle", async () => {
      const [wrongCode, wrongBackupCode] = await Promise.all([
        translateBetterAuthError({
          response: refusal({ code: "INVALID_CODE" }),
          path: "/api/auth/two-factor/verify-totp",
        }).then(bodyOf),
        translateBetterAuthError({
          response: refusal({ code: "INVALID_BACKUP_CODE" }),
          path: "/api/auth/two-factor/verify-backup-code",
        }).then(bodyOf),
      ]);

      expect(wrongCode.error).toBe("identity_mfa_code_invalid");
      expect(wrongBackupCode).toEqual(wrongCode);
    });
  });

  describe("given a challenge fails for a reason nothing anticipated", () => {
    describe("when the refusal reaches the boundary", () => {
      /** @scenario A failure we cannot name stays unnamed */
      it("attaches no invented code to it", async () => {
        const original = refusal({
          code: "SOME_FUTURE_BETTER_AUTH_FAILURE",
          status: 500,
        });

        const translated = await translateBetterAuthError({
          response: original,
          path: "/api/auth/two-factor/verify-totp",
        });

        // Untouched, deliberately. A code minted for a cause we cannot name
        // promises the caller an action they do not have.
        expect(translated).toBe(original);
        expect(
          handledErrorForBetterAuthCode({
            code: "SOME_FUTURE_BETTER_AUTH_FAILURE",
            path: "/api/auth/two-factor/verify-totp",
            detail: "…",
          }),
        ).toBeNull();
      });

      /** @scenario A failure we cannot name stays unnamed */
      it("reads on screen as 'it did not go through', with a trace identifier", async () => {
        const translated = await translateBetterAuthError({
          response: refusal({
            code: "SOME_FUTURE_BETTER_AUTH_FAILURE",
            status: 500,
          }),
          path: "/api/auth/two-factor/verify-totp",
        });
        const body = await bodyOf(translated);
        // The shape a boundary attaches for an unhandled failure: no handled
        // payload, and a trace id to correlate on.
        const asSeenByTheClient = { ...body, trace: { traceId: "trace-1" } };

        expect(readHandledError(asSeenByTheClient)).toBeNull();
        const copy = resolveErrorCopy({ error: asSeenByTheClient });
        expect(copy.title).toBe(UNKNOWN_ERROR_PRESENTATION.title);
        expect(copy.traceId).toBe("trace-1");
      });
    });
  });

  describe("given a path outside the families we translate", () => {
    /** @scenario A failure we cannot name stays unnamed */
    it("is left alone even when the code is one we know elsewhere", async () => {
      const original = refusal({ code: "INVALID_CODE" });

      const translated = await translateBetterAuthError({
        response: original,
        path: "/api/auth/sign-in/email",
      });

      // `INVALID_CODE` means a wrong authenticator code on the two-factor
      // endpoints and something else entirely on others. Translating by code
      // alone, everywhere, would be how the wrong words reach somebody.
      expect(translated).toBe(original);
    });
  });
});
