import {
  authFailureMessage,
  isCredentialRejection,
} from "~/pages/auth/authFailureMessage";
import { signIn } from "~/utils/auth-client";
import { credentialSignInFailure } from "./credentialSignIn";

/**
 * One attempt at a password, and the three things it can turn out to be.
 *
 * A refused credential is two situations wearing one answer, and only the
 * server can tell them apart: a wrong password for an account that exists, or
 * an address nobody has an account for at all. The second is somebody signing
 * up at the log-in form, so the attempt carries on as a sign-up rather than
 * becoming a refusal they have to act on.
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
   * How an address with no account becomes a sign-up. Absent where an account
   * is already known to exist, in which case a refusal is only ever a wrong
   * password.
   */
  convertToSignUp?: (input: { email: string; password: string }) => Promise<{
    outcome: "account_exists" | "verification_sent";
  }>;
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
    const answer = await convertToSignUp({ email, password });
    return answer.outcome === "verification_sent"
      ? { outcome: "signing_up" }
      : refused;
  } catch {
    // Rate-limited or unreachable: the honest refusal still stands.
    return refused;
  }
}
