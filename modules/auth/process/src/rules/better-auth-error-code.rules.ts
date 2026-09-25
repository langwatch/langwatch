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

/** better-auth's two-factor refusals and the registered code each answers with. */
export const TWO_FACTOR_REFUSAL_CODES: ReadonlyMap<string, string> = new Map([
  ["INVALID_CODE", "identity_mfa_code_invalid"],
  ["INVALID_BACKUP_CODE", "identity_mfa_code_invalid"],
  ["TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE", "identity_mfa_locked_out"],
  ["ACCOUNT_TEMPORARILY_LOCKED", "identity_mfa_locked_out"],
  ["INVALID_PASSWORD", "identity_mfa_password_invalid"],
]);

/** Whether a normalized auth pathname is one of the two-factor plugin's endpoints. */
export function isTwoFactorPath(pathname: string): boolean {
  return pathname.includes("/two-factor/");
}
