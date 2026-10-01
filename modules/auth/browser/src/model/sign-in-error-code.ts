import { CUTOVER_SIGN_IN_ERROR_CODES, type CutoverSignInErrorCode } from "@langwatch/auth-contract";
import { looksLikeSsoConnectionId } from "@langwatch/identity-contract";

/** What one refused sign-in says to the person it refused. */
export interface SignInRefusalCopy {
  title: string;
  body: string;
}

/**
 * The sign-ins an organization's move to its own single sign-on refuses, in
 * words about the person's way in rather than the move behind it.
 */
export const CUTOVER_SIGN_IN_ERRORS: Readonly<Record<CutoverSignInErrorCode, SignInRefusalCopy>> = {
  SSO_LEGACY_AUTH_RETIRED: {
    title: "Your organization moved its sign-in",
    body: "The way you used to sign in has been retired. Go back and sign in with your organization's single sign-on.",
  },
  SSO_MIGRATION_AUTH_NOT_ALLOWED: {
    title: "Use your organization's sign-in",
    body: "This account is not one your organization's single sign-on recognises. Go back and sign in with your organization's single sign-on.",
  },
  SSO_MIGRATION_LINK_NOT_ALLOWED: {
    title: "Use your organization's sign-in",
    body: "This account is not one your organization's single sign-on recognises. Go back and sign in with your organization's single sign-on.",
  },
  SSO_MIGRATION_AUTH_AMBIGUOUS: {
    title: "We could not tell which account this is",
    body: "You hold more than one account with this provider, so we cannot tell which workspace to open. Ask an administrator in your organization for help.",
  },
  SSO_MIGRATION_LINK_AMBIGUOUS: {
    title: "We could not tell which account this is",
    body: "You hold more than one account with this provider, so we cannot tell which workspace to open. Ask an administrator in your organization for help.",
  },
  SSO_MIGRATION_LINK_UNVERIFIED: {
    title: "Your sign-in did not confirm your email",
    body: "Your organization's single sign-on did not confirm your email address, so we could not connect it to your account. Ask an administrator in your organization for help.",
  },
};

/** The words for a refused sign-in, or nothing where the code names none. */
export const cutoverSignInRefusal = (error: string): SignInRefusalCopy | undefined => {
  const code = CUTOVER_SIGN_IN_ERROR_CODES.find((candidate) => candidate === error);
  return code ? CUTOVER_SIGN_IN_ERRORS[code] : undefined;
};

/** The refusal that is a bounce: a native social button at an organization's own connection. */
export const SSO_BOUNCE_ERROR = "SSO_REQUIRED_BY_ORGANIZATION";

/**
 * The connection a bounce names. The target arrives over the wire, so it is read as a connection
 * IDENTIFIER and only ever handed to `signIn`, never navigated to: anything else is not followed.
 */
export function bounceConnectionFrom({
  error,
  target,
}: {
  error: string | null | undefined;
  target: string | null | undefined;
}): string | null {
  if (error !== SSO_BOUNCE_ERROR) return null;
  if (!target || !looksLikeSsoConnectionId(target)) return null;
  return target;
}
