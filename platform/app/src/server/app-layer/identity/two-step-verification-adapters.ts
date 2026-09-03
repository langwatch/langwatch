import { IdentityMfaPasswordInvalidError } from "@langwatch/identity";
import { handledErrorForBetterAuthCode } from "~/server/better-auth/handled-errors";
import { betterAuthInstance } from "./better-auth-instance.adapter";
import type { TwoStepProtocolPort } from "./two-step-verification.service";

/**
 * What the account side reads, and how it reaches the two-factor plugin.
 *
 * `User.twoFactorEnabled` is the plugin's own column and the one answer to
 * "has this person got one" everywhere in the product — the impersonation
 * guard reads the same field, so an operator and an organization can never
 * disagree about the same person.
 */
/**
 * The two-factor plugin's endpoints, called server-side and answered in our
 * vocabulary.
 *
 * Every refusal goes through the one mapping table, so a wrong authenticator
 * code refuses here exactly the way it refuses when the browser calls the
 * endpoint itself — same code, same words, same absence of an oracle. A
 * failure the table cannot name is rethrown untouched and degrades to the
 * generic unknown with a trace id, which is the doctrine and not a gap.
 */
export class BetterAuthTwoStepProtocol implements TwoStepProtocolPort {
  async verifyCode({
    headers,
    code,
  }: {
    headers: Headers;
    code: string;
  }): Promise<void> {
    try {
      const auth = await betterAuthInstance();
      await auth.api.verifyTOTP({ body: { code }, headers });
    } catch (error) {
      throw translated({
        error,
        path: "/two-factor/verify-totp",
        detail: "verify_totp refused while turning two-step verification off",
      });
    }
  }

  async disable({
    headers,
    password,
  }: {
    headers: Headers;
    /** Absent for an account that holds none: the plugin waives the check for
     *  exactly those (`allowPasswordless`), so nothing is skipped here. */
    password?: string;
  }): Promise<void> {
    try {
      const auth = await betterAuthInstance();
      await auth.api.disableTwoFactor({
        body: password ? { password } : {},
        headers,
      });
    } catch (error) {
      // The password is the one refusal the shared table does not carry: it
      // is not a two-factor code, and sending somebody back to their
      // authenticator for a mistyped password is the wrong instruction.
      const code = betterAuthCode(error);
      if (code === "INVALID_PASSWORD" || code === "INVALID_EMAIL_OR_PASSWORD") {
        throw new IdentityMfaPasswordInvalidError(
          "disable_two_step: the password re-proof did not match",
        );
      }
      throw translated({
        error,
        path: "/two-factor/disable",
        detail: "disable refused while turning two-step verification off",
      });
    }
  }
}

/** Our error for one of better-auth's, or the original when we cannot name it. */
function translated({
  error,
  path,
  detail,
}: {
  error: unknown;
  /** The endpoint that refused: a code only means something within its
   *  family, so the table is keyed by both. */
  path: string;
  detail: string;
}): unknown {
  return (
    handledErrorForBetterAuthCode({
      code: betterAuthCode(error),
      path,
      detail,
    }) ?? error
  );
}

/**
 * better-auth's own code off a thrown `APIError`. It hangs the JSON body on
 * `body`, so the code is one level in rather than on the error itself.
 */
function betterAuthCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const body = (error as { body?: unknown }).body;
  const fromBody =
    typeof body === "object" && body !== null
      ? (body as { code?: unknown }).code
      : undefined;
  if (typeof fromBody === "string") return fromBody;
  const own = (error as { code?: unknown }).code;
  return typeof own === "string" ? own : undefined;
}
