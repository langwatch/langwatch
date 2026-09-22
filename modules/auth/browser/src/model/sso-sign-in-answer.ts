/**
 * What the sign-in endpoint answered, read without trusting its shape: a
 * refusal an administrator has to act on must not be lost to a spelling.
 */

/** What went wrong starting a sign-in, in the words its caller shows. */
export interface SignInStartFailure {
  code?: string;
  message?: string;
  statusText?: string;
  status?: number;
}

const fields = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? { ...value } : null;

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/** Where the identity provider is waiting, or null when none was named. */
export function ssoSignInAddressOf(data: unknown): string | null {
  return text(fields(data)?.url) ?? null;
}

/** The refusal, or null when nothing refused. Anything unrecognised still
 *  travels — as its own words, rather than as silence. */
export function signInStartFailureOf(error: unknown): SignInStartFailure | null {
  if (error === null || error === undefined || error === false) return null;
  const held = fields(error);
  if (!held) return { message: text(error) ?? "sign_in_refused" };
  const failure: SignInStartFailure = {
    code: text(held.code),
    message: text(held.message),
    statusText: text(held.statusText),
    status: typeof held.status === "number" ? held.status : undefined,
  };

  return Object.values(failure).some((value) => value !== undefined)
    ? failure
    : { message: "sign_in_refused" };
}

/** A refusal the endpoint answered with: what it said, under how it failed. */
export function signInRefusalOf({
  status,
  statusText,
  body,
}: {
  status: number;
  statusText: string;
  body: unknown;
}): SignInStartFailure {
  return { ...signInStartFailureOf(body), status, statusText };
}
