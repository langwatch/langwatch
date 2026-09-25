import {
  IdentityPasskeyAlreadyRegisteredError,
  IdentityPasswordRejectedError,
  IdentityResetLinkInvalidError,
  IdentitySignInRefusedError,
  TwoStepPasswordInvalidError,
} from "@langwatch/auth-contract";
import type { HandledError } from "@langwatch/handled-error";
import {
  IdentityMfaCodeInvalidError,
  IdentityMfaLockedOutError,
  IdentityPasskeyCeremonyFailedError,
  IdentityPasskeyNotRecognizedError,
  IdentityVerificationExpiredError,
  IdentityVerificationInvalidError,
} from "@langwatch/identity-contract";
import { EmailAlreadyRegisteredError } from "@langwatch/user-contract";
import { z } from "zod";

const coded = z.union([
  z.object({ body: z.object({ code: z.string() }) }).transform((error) => error.body.code),
  z.object({ code: z.string() }).transform((error) => error.code),
]);

/** Whether better-auth refused with one of these codes, read off its APIError body first. */
export function refusedWith(error: unknown, codes: readonly string[]): boolean {
  const parsed = coded.safeParse(error);
  return parsed.success && codes.includes(parsed.data);
}

/** One better-auth refusal on one route family, and the handled error it answers as. */
type BetterAuthRefusal = Readonly<{
  family: string;
  betterAuthCode: string;
  error: new (detail: string) => HandledError;
}>;

/**
 * Main's per-family table (handled-errors.ts): a code is named only where the cause is known and
 * the caller can act, and causes a caller must not tell apart share one code.
 */
export const BETTER_AUTH_REFUSALS: readonly BetterAuthRefusal[] = [
  {
    family: "/two-factor/",
    betterAuthCode: "INVALID_CODE",
    error: IdentityMfaCodeInvalidError,
  },
  {
    family: "/two-factor/",
    betterAuthCode: "INVALID_BACKUP_CODE",
    error: IdentityMfaCodeInvalidError,
  },
  {
    family: "/two-factor/",
    betterAuthCode: "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE",
    error: IdentityMfaLockedOutError,
  },
  {
    family: "/two-factor/",
    betterAuthCode: "ACCOUNT_TEMPORARILY_LOCKED",
    error: IdentityMfaLockedOutError,
  },
  {
    family: "/two-factor/",
    betterAuthCode: "INVALID_PASSWORD",
    error: TwoStepPasswordInvalidError,
  },
  {
    family: "/sign-in/",
    betterAuthCode: "INVALID_EMAIL_OR_PASSWORD",
    error: IdentitySignInRefusedError,
  },
  {
    family: "/sign-in/",
    betterAuthCode: "INVALID_PASSWORD",
    error: IdentitySignInRefusedError,
  },
  {
    family: "/sign-up/",
    betterAuthCode: "USER_ALREADY_EXISTS",
    error: EmailAlreadyRegisteredError,
  },
  {
    family: "/sign-up/",
    betterAuthCode: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
    error: EmailAlreadyRegisteredError,
  },
  {
    family: "/sign-up/",
    betterAuthCode: "PASSWORD_TOO_SHORT",
    error: IdentityPasswordRejectedError,
  },
  {
    family: "/sign-up/",
    betterAuthCode: "PASSWORD_TOO_LONG",
    error: IdentityPasswordRejectedError,
  },
  {
    family: "/reset-password",
    betterAuthCode: "INVALID_TOKEN",
    error: IdentityResetLinkInvalidError,
  },
  {
    family: "/reset-password",
    betterAuthCode: "TOKEN_EXPIRED",
    error: IdentityResetLinkInvalidError,
  },
  {
    family: "/reset-password",
    betterAuthCode: "PASSWORD_TOO_SHORT",
    error: IdentityPasswordRejectedError,
  },
  {
    family: "/reset-password",
    betterAuthCode: "PASSWORD_TOO_LONG",
    error: IdentityPasswordRejectedError,
  },
  {
    family: "/verify-email",
    betterAuthCode: "INVALID_TOKEN",
    error: IdentityVerificationInvalidError,
  },
  {
    family: "/verify-email",
    betterAuthCode: "TOKEN_EXPIRED",
    error: IdentityVerificationExpiredError,
  },
  {
    family: "/passkey/",
    betterAuthCode: "PASSKEY_NOT_FOUND",
    error: IdentityPasskeyNotRecognizedError,
  },
  {
    family: "/passkey/",
    betterAuthCode: "AUTHENTICATION_FAILED",
    error: IdentityPasskeyNotRecognizedError,
  },
  {
    family: "/passkey/",
    betterAuthCode: "CHALLENGE_NOT_FOUND",
    error: IdentityPasskeyCeremonyFailedError,
  },
  {
    family: "/passkey/",
    betterAuthCode: "FAILED_TO_VERIFY_REGISTRATION",
    error: IdentityPasskeyCeremonyFailedError,
  },
  {
    family: "/passkey/",
    betterAuthCode: "PREVIOUSLY_REGISTERED",
    error: IdentityPasskeyAlreadyRegisteredError,
  },
];

/** The registered refusals for one better-auth code on one normalized auth pathname. */
export function findRegisteredRefusals({
  pathname,
  betterAuthCode,
}: {
  pathname: string;
  betterAuthCode: string;
}): BetterAuthRefusal[] {
  return BETTER_AUTH_REFUSALS.filter(
    (refusal) => refusal.betterAuthCode === betterAuthCode && pathname.includes(refusal.family),
  );
}
