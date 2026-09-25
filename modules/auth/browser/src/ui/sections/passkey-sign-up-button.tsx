import type { SignInMethod } from "@langwatch/identity-contract";
import { useState } from "react";

import { authClient, navigate, safeRedirectTarget } from "../../behavior/auth-client.tsx";
import { rememberLastUsedMethod } from "../../model/last-used-method.ts";
import { isCeremonyAbandoned, passkeyFailure } from "../../model/passkey-failure.ts";
import { MethodButton } from "../elements/method-button.tsx";
import { SignInMethodIcon } from "../elements/sign-in-method-icon.tsx";

/** The mark, drawn by the same function every method on the rail is drawn by. */
const PASSKEY: SignInMethod = {
  id: "passkey",
  kind: "passkey",
  connectionId: null,
};

/**
 * The server's code for "that address already has an account", refused
 * before the ceremony so no system prompt opens for it. Kept in step with
 * `server/better-auth/passkey-signup.ts`, the only thing that sends it.
 */
const EMAIL_ALREADY_REGISTERED = "EMAIL_ALREADY_REGISTERED";

/**
 * The `code` off a client error, where it carried one — the ceremony's own
 * failures always name one, a server refusal only if the endpoint set it,
 * so it has to be asked for rather than read directly.
 */
function readCode(error: object): string | undefined {
  return "code" in error && typeof error.code === "string" ? error.code : void 0;
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
 * Runs the ceremony and says what came of it. The address and its mailbox proof
 * travel as the registration `context`, baked into the stored challenge, so the
 * created account is for the address the proof confirmed — not swappable mid-flow.
 */
async function createAccountWithPasskey({
  email,
  addressProof,
}: {
  email: string;
  addressProof: string;
}): Promise<Refusal | "created"> {
  try {
    const result = await authClient.passkey.addPasskey({
      context: JSON.stringify({ email, addressProof }),
      name: email,
      // The session is minted by the same transaction that writes the
      // credential, so this button ends with somebody signed in rather than
      // holding a passkey for an account they must now sign in to — which
      // would mean a second system prompt straight after the first.
      createSession: true,
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
  // Saying "went wrong" about a cancelled prompt would scold somebody for
  // deciding. But only the explicit abort is that: a status-less client
  // failure isn't, and treating every status-less error as a cancel left a
  // FAILED ceremony spinning silently forever with no way to retry.
  if (isCeremonyAbandoned({ code })) {
    return { kind: "silent" };
  }
  return {
    kind: "report",
    error: passkeyFailure(error.status === 0 ? void 0 : error.status),
  };
}

/**
 * Create account with passkey; ceremony creates account and session; cancel left unpunished
 */
export function PasskeySignUpButton({
  email,
  addressProof,
  callbackUrl,
  onError,
  onAddressAlreadyRegistered,
}: {
  /** The address typed on the step before. Becomes the account's. */
  email: string;
  /** The proof the spent link returned; the ceremony spends it. */
  addressProof: string;
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

    const outcome = await createAccountWithPasskey({ email, addressProof });
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
