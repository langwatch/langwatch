import type { SignInMethod } from "@langwatch/identity";
import { useState } from "react";
import { authClient, navigate, safeRedirectTarget } from "~/utils/auth-client";
import { rememberLastUsedMethod } from "../logic/lastUsedMethod";
import { MethodButton } from "./MethodButton";
import { SignInMethodIcon } from "./SignInMethodIcon";

/** The mark, drawn by the same function every method on the rail is drawn by. */
const PASSKEY: SignInMethod = {
  id: "passkey",
  kind: "passkey",
  connectionId: null,
};

/**
 * The server's code for "that address already has an account", refused before
 * the ceremony so no system prompt opens for it. Kept in step with
 * `server/better-auth/passkey-signup.ts`, which is the only thing that sends
 * it.
 */
const EMAIL_ALREADY_REGISTERED = "EMAIL_ALREADY_REGISTERED";

/**
 * The `code` off a client error, where it carried one. The client types the
 * error as "a code, or not" depending on which leg failed — the ceremony's own
 * failures always name one, a server refusal names one only if the endpoint
 * set it — so it has to be asked for rather than read.
 */
function readCode(error: object): string | undefined {
  return "code" in error && typeof error.code === "string"
    ? error.code
    : void 0;
}

/** What went wrong, in a code the client registry has words for. */
function passkeyFailure(status: number | undefined): { error: string } {
  const refused = status === 400 || status === 401 || status === 403;
  return {
    error: refused
      ? "identity_passkey_not_recognized"
      : "identity_passkey_ceremony_failed",
  };
}

/**
 * What a refused ceremony means for the screen. Three outcomes, and only one
 * of them is a failure worth showing anybody.
 */
type Refusal =
  /** The wrong door: the screen becomes the log-in one, address carried. */
  | { kind: "address_taken" }
  /** A decision, not a fault — the prompt was opened and closed. */
  | { kind: "silent" }
  | { kind: "report"; error: { error: string } };

/**
 * Runs the ceremony and says what came of it. The address travels as the
 * registration `context`: it is baked into the stored challenge, so the
 * account created at the end is for the address the ceremony was started for
 * and cannot be swapped for another in between.
 */
async function createAccountWithPasskey(
  email: string,
): Promise<Refusal | "created"> {
  try {
    const result = await authClient.passkey.addPasskey({
      context: email,
      name: email,
    });
    return result?.error ? readRefusal(result.error) : "created";
  } catch {
    // A throw from the WebAuthn client — unsupported, an insecure origin, a
    // ceremony that never got started. It never reached the server, so there
    // is no status to read and nothing to tell apart.
    return { kind: "report", error: passkeyFailure(void 0) };
  }
}

function readRefusal(error: { status: number } & object): Refusal {
  const code = readCode(error);
  if (code === EMAIL_ALREADY_REGISTERED) return { kind: "address_taken" };
  // Saying "something went wrong" about a cancelled prompt would be telling
  // somebody off for deciding, and the password fields are still on screen.
  if (code === "ERROR_CEREMONY_ABORTED" || error.status === 0) {
    return { kind: "silent" };
  }
  return { kind: "report", error: passkeyFailure(error.status) };
}

/**
 * Creating the account WITH a passkey, on the step that would otherwise only
 * take a password (Passkey Central, "New account creation with a passkey").
 *
 * It is the same ceremony the settings screen runs, with the account created
 * at the end of it rather than found at the start: the address travels as the
 * registration `context`, the server refuses one that already has an account,
 * and the session is minted by the same hook that creates the account — so
 * this button ends with somebody signed in, not with a credential for an
 * account they still have to sign in to.
 *
 * Cancelling is not a failure and is not reported as one. The password fields
 * are still on the screen underneath, which is the whole reason this is a
 * button beside them rather than a step in front of them: declining a passkey
 * costs somebody nothing and leaves the other way of finishing exactly where
 * it was.
 */
export function PasskeySignUpButton({
  email,
  callbackUrl,
  onError,
  onAddressAlreadyRegistered,
}: {
  /** The address typed on the step before. Becomes the account's. */
  email: string;
  callbackUrl: string;
  /** A refused ceremony, sent to the card's one alert at the top. */
  onError: (error: unknown) => void;
  /**
   * The address turned out to have an account. Not a refusal — it is the
   * wrong door, and the screen becomes the right one with the address in it.
   */
  onAddressAlreadyRegistered?: () => void;
}) {
  const [isBusy, setIsBusy] = useState(false);

  const dial = async () => {
    onError(null);
    setIsBusy(true);

    const outcome = await createAccountWithPasskey(email);
    if (outcome === "created") {
      // Busy stays on: the session is open and the next thing to happen is a
      // navigation, so releasing the button first only flashes it back.
      rememberLastUsedMethod({ id: "passkey" });
      navigate(safeRedirectTarget(callbackUrl));
      return;
    }

    setIsBusy(false);
    if (outcome.kind === "address_taken") onAddressAlreadyRegistered?.();
    if (outcome.kind === "report") onError(outcome.error);
  };

  return (
    <MethodButton
      icon={<SignInMethodIcon method={PASSKEY} />}
      label="Create account with a passkey"
      isBusy={isBusy}
      onClick={() => void dial()}
      testId="passkey-sign-up"
    />
  );
}
