import { authFailureMessage, isCredentialRejection } from "../model/auth-failure-message.ts";
import { credentialSignInFailure } from "../model/credential-sign-in.ts";
import { signIn } from "./auth-client.tsx";

/** The handled error a correct but untrusted password is refused with. */
const PASSWORD_RESET_REQUIRED = "identity_password_reset_required";

/**
 * Password attempt with four outcomes. A refused credential for an address
 * the router says nobody holds becomes a sign-up; nothing is mailed here.
 * A correct password that owes a second factor is a challenge, not a session.
 */
export type CredentialAttempt =
  | { outcome: "signed_in" }
  | { outcome: "signing_up" }
  | { outcome: "two_step_required" }
  /** A correct password an operator marked as no longer trusted: choose a new one first. */
  | { outcome: "password_reset_required" }
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
  /** Asks the router whether anybody holds the address; sends nothing to anybody. */
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

  if (response?.twoStepRequired) return { outcome: "two_step_required" };
  if (response?.code === PASSWORD_RESET_REQUIRED) return { outcome: "password_reset_required" };

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
    // A router that could not answer leaves the honest refusal standing.
    return refused;
  }
}
