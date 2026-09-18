import { authFailureMessage, isCredentialRejection } from "../model/auth-failure-message.ts";
import { credentialSignInFailure } from "../model/credential-sign-in.ts";
import { signIn } from "./auth-client.tsx";

/**
 * Password attempt with three outcomes (signed in, signing up, refused).
 * Refused credential (wrong password vs no account) auto-converts to sign-up;
 * asks for confirmation link, not password.
 */
export type CredentialAttempt =
  | { outcome: "signed_in" }
  | { outcome: "signing_up" }
  | {
      outcome: "refused";
      message: string;
      /** The rate limiter's remaining window, when it sent one. */
      retryAfterSeconds: number | null;
    };

export async function attemptCredentialSignIn({
  email,
  password,
  callbackUrl,
  convertToSignUp,
}: {
  email: string;
  password: string;
  callbackUrl?: string;
  /**
   * Sign-up fallback for unknown address; refuses known accounts to distinguish from wrong password
   */
  convertToSignUp?: (input: { email: string }) => Promise<unknown>;
}): Promise<CredentialAttempt> {
  let response: Awaited<ReturnType<typeof signIn>>;
  try {
    response = await signIn("credentials", { email, password, callbackUrl });
  } catch (error) {
    return {
      outcome: "refused",
      message: authFailureMessage({
        message: error instanceof Error ? error.message : void 0,
      }),
      retryAfterSeconds: null,
    };
  }

  const failure = credentialSignInFailure({ response });
  if (!failure) return { outcome: "signed_in" };

  const refused: CredentialAttempt = {
    outcome: "refused",
    message: failure.message,
    retryAfterSeconds: failure.retryAfterSeconds,
  };

  const looksLikeWrongCredentials = isCredentialRejection({
    code: response?.code,
    message: response?.error,
  });
  if (!looksLikeWrongCredentials || !convertToSignUp) return refused;

  try {
    await convertToSignUp({ email });
    return { outcome: "signing_up" };
  } catch {
    // The address already has an account (so this really was a wrong
    // password), or the request was rate-limited or could not be made. All
    // three leave the honest refusal standing, which is the safe way to be
    // wrong: it never claims a link is coming when none is.
    return refused;
  }
}
