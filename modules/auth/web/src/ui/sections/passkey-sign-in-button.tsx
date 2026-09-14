import type { SignInMethod } from "@langwatch/identity-contract";
import type { ReactNode } from "react";
import { useState } from "react";
import { authClient, navigate, safeRedirectTarget } from "../../behavior/auth-client.tsx";
import { rememberLastUsedMethod } from "../../model/last-used-method.ts";
import { signInMethodActionLabel } from "../../model/method-labels.ts";
import { MethodButton } from "../elements/method-button.tsx";
import { SignInMethodIcon } from "../elements/sign-in-method-icon.tsx";

/** The client's name for the ceremony, so the mark and the words are drawn by
 *  the same two functions every other method on the rail is drawn by. */
const PASSKEY: SignInMethod = {
  id: "passkey",
  kind: "passkey",
  connectionId: null,
};

/**
 * Passkey failure code from WebAuthn client, mapped to registry vocabulary
 */
function passkeyFailure(status: number | undefined): { error: string } {
  // The server looked at the credential and said no. Same answer whether it
  // belongs to somebody else or to nobody — the endpoint does not say which.
  const refused = status === 400 || status === 401 || status === 403;
  return {
    error: refused ? "identity_passkey_not_recognized" : "identity_passkey_ceremony_failed",
  };
}

/**
 * Passkey sign-in; ceremony browser-driven; no address sent; refusal reported up, not drawn here
 */
export function PasskeySignInButton({
  callbackUrl,
  badge,
  onError,
}: {
  callbackUrl?: string;
  /** "Last used", where this browser remembers getting in this way. */
  badge?: ReactNode;
  /** Where a refusal goes: the card's alert, at the top. */
  onError: (error: unknown) => void;
}) {
  const [isBusy, setIsBusy] = useState(false);

  const dial = async () => {
    onError(null);
    setIsBusy(true);
    try {
      const result = await authClient.signIn.passkey();
      // A cancelled prompt is not a failure worth shouting about: the person
      // closed it, and the other methods are still on the screen behind this.
      if (result?.error) {
        if (result.error.status !== 0) {
          onError(passkeyFailure(result.error.status));
        }
        return;
      }
      rememberLastUsedMethod({ id: "passkey" });
      navigate(safeRedirectTarget(callbackUrl));
    } catch {
      // A throw from the WebAuthn client — unsupported, an insecure origin, a
      // ceremony that never got started. It never reached the server, so there
      // is no status to read and nothing to tell apart.
      onError(passkeyFailure(void 0));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <MethodButton
      icon={<SignInMethodIcon method={PASSKEY} />}
      label={signInMethodActionLabel(PASSKEY)}
      badge={badge}
      isBusy={isBusy}
      onClick={() => void dial()}
      testId="passkey-sign-in"
    />
  );
}
