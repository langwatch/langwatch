import type { HandledError } from "@langwatch/handled-error";
import {
  IdentityMfaCodeInvalidError,
  IdentityMfaLockedOutError,
  IdentityPasskeyAlreadyRegisteredError,
  IdentityPasskeyCeremonyFailedError,
  IdentityPasskeyNotRecognizedError,
  IdentityPasswordRejectedError,
  IdentityResetLinkInvalidError,
  IdentitySignInRefusedError,
  IdentityVerificationExpiredError,
  IdentityVerificationInvalidError,
} from "@langwatch/identity";
import { handledErrorResponseBody } from "~/app/api/middleware/error-handler";
import { EmailAlreadyRegisteredError } from "~/server/users/errors";

/**
 * better-auth's refusals, as OUR handled errors.
 *
 * better-auth answers a failure with its own JSON — `{ code, message }` in its
 * own vocabulary — which reaches a browser as neither a registered code nor
 * copy anybody wrote for a customer. Everything else in the product speaks the
 * handled-error contract (ADR-045): a stable `code`, a customer-safe
 * `message`, and words that come from the code-keyed presentation registry.
 * This is where the auth endpoints join it.
 *
 * The rule is the doctrine's, not a convenience: a code is translated ONLY
 * where we know the cause and the caller can act on it. Everything else is
 * left exactly as better-auth sent it, degrades to the generic unknown with a
 * trace id, and stays that way — inventing a handled code for a cause we
 * cannot name would promise the caller an action they do not have.
 *
 * ONE table, deliberately. Every family extends it in place rather than
 * growing a second translation of the same kind of thing.
 */

/**
 * The paths whose failures are translated, and — because a matched prefix is
 * also the FAMILY a code belongs to — half of every key in the table below.
 *
 * Scoped rather than global, which is the property that lets the families
 * disagree about what a code means. `INVALID_TOKEN` is a dead password-reset
 * link on one prefix and an unusable confirmation link on another, and the two
 * want different words; keying the table by `<prefix> <CODE>` is what lets
 * both be right without a second table.
 *
 * Absent on purpose, and each absence is a decision:
 *
 *   - `/request-password-reset` — it answers the same way whether or not the
 *     address has an account (`specs/auth/password-reset.feature`), so there
 *     is no refusal there to name, and a code on it would be the oracle the
 *     endpoint exists not to be.
 *   - the social and OAuth callback paths — a failure there is the provider's
 *     or the deployment's, and neither is something the caller can act on.
 */
const TRANSLATED_PATH_PREFIXES = [
  "/two-factor/",
  "/sign-in/",
  "/sign-up/",
  "/reset-password",
  "/verify-email",
  "/passkey/",
] as const;

/**
 * `<matched prefix> <better-auth's code>`, and the handled error it means.
 *
 * The two invalid-code variants collapse to ONE code on purpose, and this is
 * the single most load-bearing line in the file: better-auth distinguishes a
 * wrong authenticator code from a wrong backup code, and answering
 * differently would make the endpoint an oracle for which check a caller had
 * just failed — and, with it, for whether an account holds backup codes at
 * all. Which of the two it was goes to the log line, through the detail
 * carried on the error's own reason.
 *
 * The same rule governs every family added since:
 *
 *   - a credential sign-in has ONE refusal. better-auth already answers a
 *     wrong password and an address nobody holds with the same
 *     `INVALID_EMAIL_OR_PASSWORD`, and `identity_sign_in_refused` keeps them
 *     indistinguishable once the wire carries a code of ours
 *     (`specs/auth/sign-in-failure-messages.feature`,
 *     `specs/auth/signup-does-not-strand-an-account.feature`).
 *   - a reset link that will not spend has ONE refusal, whether it expired,
 *     was already used, or never existed.
 *   - a passkey we will not accept has ONE refusal, whether the credential
 *     belongs to somebody else or to nobody.
 *
 * Absent on purpose, beyond the prefixes above: `INVALID_TWO_FACTOR_COOKIE`,
 * the `*_NOT_ENABLED` and `*_NOT_CONFIGURED` family, `OTP_HAS_EXPIRED`,
 * `EMAIL_NOT_VERIFIED` (our sign-in does not gate on it, so no surface can
 * reach it), the passkey plugin's `UNABLE_TO_CREATE_SESSION`,
 * `RESOLVE_USER_REQUIRED`, `RESOLVED_USER_INVALID` and `UNKNOWN_ERROR`, and
 * the two cancellation codes — a cancelled ceremony is a decision somebody
 * made, not a failure to report. Each is either a deployment fault the
 * customer cannot act on or a state our surfaces cannot reach, so each stays
 * unnamed rather than getting a code invented for it.
 *
 * `EMAIL_ALREADY_REGISTERED` on `/passkey/generate-register-options` is absent
 * for a third reason: it is OURS (`passkey-signup.ts`), the sign-up screen
 * watches for that exact string to turn itself into the log-in screen, and
 * translating it would break the conversion it exists for.
 */
const HANDLED_BY_BETTER_AUTH_CODE: Record<
  string,
  (detail: string) => HandledError
> = {
  "/two-factor/ INVALID_CODE": (detail) =>
    new IdentityMfaCodeInvalidError(detail),
  "/two-factor/ INVALID_BACKUP_CODE": (detail) =>
    new IdentityMfaCodeInvalidError(detail),
  "/two-factor/ TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE": (detail) =>
    new IdentityMfaLockedOutError(detail),
  "/two-factor/ ACCOUNT_TEMPORARILY_LOCKED": (detail) =>
    new IdentityMfaLockedOutError(detail),

  "/sign-in/ INVALID_EMAIL_OR_PASSWORD": (detail) =>
    new IdentitySignInRefusedError(detail),
  "/sign-in/ INVALID_PASSWORD": (detail) =>
    new IdentitySignInRefusedError(detail),

  "/sign-up/ USER_ALREADY_EXISTS": () => new EmailAlreadyRegisteredError(),
  "/sign-up/ USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL": () =>
    new EmailAlreadyRegisteredError(),
  "/sign-up/ PASSWORD_TOO_SHORT": (detail) =>
    new IdentityPasswordRejectedError(detail),
  "/sign-up/ PASSWORD_TOO_LONG": (detail) =>
    new IdentityPasswordRejectedError(detail),

  "/reset-password INVALID_TOKEN": (detail) =>
    new IdentityResetLinkInvalidError(detail),
  "/reset-password TOKEN_EXPIRED": (detail) =>
    new IdentityResetLinkInvalidError(detail),
  "/reset-password PASSWORD_TOO_SHORT": (detail) =>
    new IdentityPasswordRejectedError(detail),
  "/reset-password PASSWORD_TOO_LONG": (detail) =>
    new IdentityPasswordRejectedError(detail),

  "/verify-email INVALID_TOKEN": (detail) =>
    new IdentityVerificationInvalidError(),
  "/verify-email TOKEN_EXPIRED": () => new IdentityVerificationExpiredError(),

  "/passkey/ PASSKEY_NOT_FOUND": (detail) =>
    new IdentityPasskeyNotRecognizedError(detail),
  "/passkey/ AUTHENTICATION_FAILED": (detail) =>
    new IdentityPasskeyNotRecognizedError(detail),
  "/passkey/ CHALLENGE_NOT_FOUND": (detail) =>
    new IdentityPasskeyCeremonyFailedError(detail),
  "/passkey/ FAILED_TO_VERIFY_REGISTRATION": (detail) =>
    new IdentityPasskeyCeremonyFailedError(detail),
  "/passkey/ PREVIOUSLY_REGISTERED": (detail) =>
    new IdentityPasskeyAlreadyRegisteredError(detail),
};

/** The prefix this path is translated under, or null when it is not. */
function translatedFamily(path: string): string | null {
  return (
    TRANSLATED_PATH_PREFIXES.find((prefix) => path.includes(prefix)) ?? null
  );
}

/** Whether this request's failures are ours to translate. */
export function translatesBetterAuthErrors(path: string): boolean {
  return translatedFamily(path) !== null;
}

/**
 * The handled error one of better-auth's codes means on one of its paths, or
 * null when we cannot name the cause.
 *
 * Takes the PATH rather than a family label, because the family is a fact
 * about the path and deriving it in one place is what stops a caller passing
 * the wrong one.
 *
 * Exported so a caller holding the code already — a server-side `auth.api`
 * call, which throws rather than answering a Response — can translate without
 * going through a body.
 */
export function handledErrorForBetterAuthCode({
  code,
  path,
  detail,
}: {
  code: string | undefined;
  path: string;
  detail: string;
}): HandledError | null {
  if (!code) return null;
  const family = translatedFamily(path);
  if (family === null) return null;
  const build = HANDLED_BY_BETTER_AUTH_CODE[`${family} ${code}`];
  return build ? build(detail) : null;
}

/** better-auth's own code off a parsed body, or undefined. */
function codeIn(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const code = (payload as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * One of better-auth's error responses, re-answered in the handled-error
 * contract — or the response untouched, which is the common case.
 *
 * Untouched covers everything that is not a failure, everything on a path we
 * do not translate, and every code we cannot name. The status and every
 * header (the session cookies especially) survive either way: this rewrites a
 * BODY, and nothing else about the answer.
 */
export async function translateBetterAuthError({
  response,
  path,
}: {
  response: Response;
  path: string;
}): Promise<Response> {
  if (response.ok || response.status < 400) return response;
  if (!translatesBetterAuthErrors(path)) return response;

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) return response;

  const clone = response.clone();
  let payload: unknown;
  try {
    payload = await clone.json();
  } catch {
    // A body we cannot read is a body we cannot translate. The original
    // answer is still a correct one.
    return response;
  }

  const code = codeIn(payload);
  const handled = handledErrorForBetterAuthCode({
    code,
    path,
    // The precise reason, for the log line and never for the response: a
    // handled error's `reasons` do not cross the boundary as prose.
    detail: `${path} refused with ${code ?? "an unnamed code"}`,
  });
  if (!handled) return response;

  const { statusCode, body } = handledErrorResponseBody(handled);
  const headers = new Headers(response.headers);
  headers.set("content-type", "application/json");
  // The length of the body we are replacing is not the length of the one we
  // are sending.
  headers.delete("content-length");
  return new Response(JSON.stringify(body), { status: statusCode, headers });
}
