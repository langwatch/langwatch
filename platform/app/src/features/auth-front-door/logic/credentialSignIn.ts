import { authFailureMessage } from "~/pages/auth/authFailureMessage";

/** What the auth client answers a credential sign-in with. */
export interface CredentialSignInResponse {
  error?: string;
  code?: string;
  status?: number;
}

/**
 * The wording for a credential sign-in that did not go through, or null when
 * it did.
 *
 * One reader for both screens, over the same mapper the legacy screens use:
 * the failure anchors (`sign-in-failure-messages.feature`) say a wrong
 * password, a rate limit and an installation set up for another address each
 * get their own sentence, and none of them ever puts an identifier on screen.
 */
export function credentialSignInFailure({
  response,
  fallback,
}: {
  response: CredentialSignInResponse | null | undefined;
  fallback?: string;
}): string | null {
  const failed =
    Boolean(response?.error) ||
    (response?.status !== undefined && response.status >= 400);
  if (!failed) return null;

  return authFailureMessage({
    code: response?.code,
    message: response?.error,
    status: response?.status,
    fallback,
  });
}
