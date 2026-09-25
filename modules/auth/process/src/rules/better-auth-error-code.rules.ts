import type { HandledError } from "@langwatch/handled-error";
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

/** One better-auth refusal on one route family, and the registered code it answers with. */
type BetterAuthRefusal = Readonly<{
  family: string;
  betterAuthCode: string;
  code: HandledError["code"];
}>;

/**
 * Main's per-family table (handled-errors.ts): a code is named only where the cause is known and
 * the caller can act, and causes a caller must not tell apart share one code.
 */
export const BETTER_AUTH_REFUSALS: readonly BetterAuthRefusal[] = [
  { family: "/two-factor/", betterAuthCode: "INVALID_CODE", code: "identity_mfa_code_invalid" },
  {
    family: "/two-factor/",
    betterAuthCode: "INVALID_BACKUP_CODE",
    code: "identity_mfa_code_invalid",
  },
  {
    family: "/two-factor/",
    betterAuthCode: "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE",
    code: "identity_mfa_locked_out",
  },
  {
    family: "/two-factor/",
    betterAuthCode: "ACCOUNT_TEMPORARILY_LOCKED",
    code: "identity_mfa_locked_out",
  },
  {
    family: "/two-factor/",
    betterAuthCode: "INVALID_PASSWORD",
    code: "identity_mfa_password_invalid",
  },
  {
    family: "/sign-in/",
    betterAuthCode: "INVALID_EMAIL_OR_PASSWORD",
    code: "identity_sign_in_refused",
  },
  { family: "/sign-in/", betterAuthCode: "INVALID_PASSWORD", code: "identity_sign_in_refused" },
  { family: "/sign-up/", betterAuthCode: "USER_ALREADY_EXISTS", code: "email_already_registered" },
  {
    family: "/sign-up/",
    betterAuthCode: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
    code: "email_already_registered",
  },
  { family: "/sign-up/", betterAuthCode: "PASSWORD_TOO_SHORT", code: "identity_password_rejected" },
  { family: "/sign-up/", betterAuthCode: "PASSWORD_TOO_LONG", code: "identity_password_rejected" },
  {
    family: "/reset-password",
    betterAuthCode: "INVALID_TOKEN",
    code: "identity_reset_link_invalid",
  },
  {
    family: "/reset-password",
    betterAuthCode: "TOKEN_EXPIRED",
    code: "identity_reset_link_invalid",
  },
  {
    family: "/reset-password",
    betterAuthCode: "PASSWORD_TOO_SHORT",
    code: "identity_password_rejected",
  },
  {
    family: "/reset-password",
    betterAuthCode: "PASSWORD_TOO_LONG",
    code: "identity_password_rejected",
  },
  {
    family: "/verify-email",
    betterAuthCode: "INVALID_TOKEN",
    code: "identity_verification_invalid",
  },
  {
    family: "/verify-email",
    betterAuthCode: "TOKEN_EXPIRED",
    code: "identity_verification_expired",
  },
  {
    family: "/passkey/",
    betterAuthCode: "PASSKEY_NOT_FOUND",
    code: "identity_passkey_not_recognized",
  },
  {
    family: "/passkey/",
    betterAuthCode: "AUTHENTICATION_FAILED",
    code: "identity_passkey_not_recognized",
  },
  {
    family: "/passkey/",
    betterAuthCode: "CHALLENGE_NOT_FOUND",
    code: "identity_passkey_ceremony_failed",
  },
  {
    family: "/passkey/",
    betterAuthCode: "FAILED_TO_VERIFY_REGISTRATION",
    code: "identity_passkey_ceremony_failed",
  },
  {
    family: "/passkey/",
    betterAuthCode: "PREVIOUSLY_REGISTERED",
    code: "identity_passkey_already_registered",
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
