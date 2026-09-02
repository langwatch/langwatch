import {
  authFailureMessage,
  isCredentialRejection,
} from "./auth-failure-message";
import { signIn } from "../behavior/auth-client";
import { credentialSignInFailure } from "./credential-sign-in";

/**
 * One attempt at a password, and the three things it can turn out to be.
 *
 * A refused credential is two situations wearing one answer, and only the
 * server can tell them apart: a wrong password for an account that exists, or
 * an address nobody has an account for at all. The second is somebody signing
 * up at the log-in form, so the attempt carries on as a sign-up rather than
 * becoming a refusal they have to act on.
 *
 * What it does NOT do is keep the password. It asks for the same confirmation
 * link the sign-up door asks for, and the password is chosen once, afterwards,
 * on the one screen built to ask for it — typed twice and held to a length.
 * Banking whatever was typed into a field labelled `current-password` meant an
 * account could be created two ways, and the log-in way took a single
 * character and never asked twice.
 *
 * Kept out of the component because it is the one piece of this screen that is
 * a decision rather than a rendering, and because it is the piece a test wants
 * to drive without a form around it.
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
   * How an address with no account becomes a sign-up: it asks for the same
   * confirmation link the sign-up door asks for, and takes no password. It
   * REFUSES for an address that does have an account, which is what tells the
   * two situations apart — so a wrong password stays a wrong password.
   *
   * Absent where an account is already known to exist, in which case a refusal
   * is only ever a wrong password.
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
