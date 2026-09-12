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
 * What it does NOT do is keep the password. The password is chosen once, on
 * the credential step, typed twice and held to a length. Banking whatever was
 * typed into a field labelled `current-password` meant an account could be
 * created two ways, and the log-in way took a single character and never asked
 * twice.
 *
 * Nor does it MAIL anything. It used to: the way it told the two situations
 * apart was by asking for a confirmation link and seeing whether that was
 * refused, so learning the address was free sent a stranger a message before
 * they had chosen anything at all. Asking the router instead answers the same
 * question and sends nothing, which is what lets the credential step come
 * first on this door too.
 *
 * Kept out of the component because it is the one piece of this screen that is
 * a decision rather than a rendering, and because it is the piece a test wants
 * to drive without a form around it.
 */
export type CredentialAttempt =
  | { outcome: "signed_in" }
  /**
   * Nobody holds this address, so the journey is a sign-up. Nothing has been
   * created and nothing has been sent — the screen's next move is to ask for a
   * credential, and the call that takes it is what creates the account and
   * mails the link.
   */
  | { outcome: "signing_up" }
  /**
   * The password was right and a second factor is still owed. Not a refusal:
   * there is nothing to fix and nothing to say sorry for, so the screen asks
   * the next question rather than reporting a failure.
   */
  | { outcome: "two_step_required" }
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
  addressHasNoAccount,
}: {
  email: string;
  password: string;
  callbackUrl?: string;
  /**
   * Whether nobody holds this address — the one question that tells a wrong
   * password apart from somebody signing up at the log-in form.
   *
   * A CHECK, deliberately, rather than the request that starts a sign-up.
   * Answering it must cost the person nothing, because it is asked on every
   * refused password: a stranger who mistypes their own address gets a screen
   * that offers to create an account, not a message in somebody else's inbox.
   *
   * Absent where an account is already known to exist, in which case a refusal
   * is only ever a wrong password. False on anything it cannot determine — a
   * refusal that stands is the safe way to be wrong, since it never claims an
   * address is free when it may not be.
   */
  addressHasNoAccount?: (input: { email: string }) => Promise<boolean>;
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

  // Asked before the refusal is read, because a challenge is neither a refusal
  // nor a session: the response carries no error and no cookie, and reading it
  // as a success is what used to bounce an enrolled account off its own
  // callback URL.
  if (response?.twoStepRequired) return { outcome: "two_step_required" };

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
  if (!looksLikeWrongCredentials || !addressHasNoAccount) return refused;

  try {
    if (!(await addressHasNoAccount({ email }))) return refused;
    return { outcome: "signing_up" };
  } catch {
    // The check could not be made — rate-limited, or the request failed. The
    // honest refusal stands, which is the safe way to be wrong: it never sends
    // somebody off to create an account they may already have.
    return refused;
  }
}
