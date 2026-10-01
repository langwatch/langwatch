import type { SignInMethod } from "@langwatch/identity-contract";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { authClient, navigate, safeRedirectTarget } from "../../behavior/auth-client.tsx";
import { rememberLastUsedMethod } from "../../model/last-used-method.ts";
import { signInMethodActionLabel } from "../../model/method-labels.ts";
import { passkeyFailure } from "../../model/passkey-failure.ts";
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
 * Passkey sign-in; ceremony browser-driven; no address sent; refusal reported up, not drawn here
 */
export function PasskeySignInButton({
  callbackUrl,
  badge,
  onError,
  onBusyChange,
  autoStart = false,
  onAutoStarted,
  onDeclined,
}: {
  callbackUrl?: string;
  /** "Last used", where this browser remembers getting in this way. */
  badge?: ReactNode;
  /** Where a refusal goes: the card's alert, at the top. */
  onError: (error: unknown) => void;
  /**
   * Told while this ceremony is in flight, so a rail with more than one way
   * in can hold the others back — a second method dialed mid-ceremony would
   * open a competing WebAuthn prompt on top of this one.
   */
  onBusyChange?: (isBusy: boolean) => void;
  /** Start as soon as the button appears: the address submit was the gesture. */
  autoStart?: boolean;
  /** The screen remembers the attempt, because a remounted button would not. */
  onAutoStarted?: () => void;
  /** The ceremony ended without a session. */
  onDeclined?: () => void;
}) {
  const [isBusy, setIsBusy] = useState(false);

  const setBusy = (next: boolean) => {
    setIsBusy(next);
    onBusyChange?.(next);
  };

  const dial = async () => {
    onError(null);
    setBusy(true);
    try {
      const result = await authClient.signIn.passkey();
      // A cancelled prompt is not a failure worth shouting about: the person
      // closed it, and the other methods are still on the screen behind this.
      if (result?.error) {
        if (result.error.status !== 0) {
          onError(passkeyFailure(result.error.status));
        }
        onDeclined?.();
        return;
      }
      rememberLastUsedMethod({ id: "passkey" });
      navigate(safeRedirectTarget(callbackUrl));
    } catch {
      // A throw from the WebAuthn client — unsupported, an insecure origin, a
      // ceremony that never got started. It never reached the server, so there
      // is no status to read and nothing to tell apart.
      onError(passkeyFailure(void 0));
      onDeclined?.();
    } finally {
      setBusy(false);
    }
  };

  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoStart || autoStarted.current) return;
    autoStarted.current = true;
    onAutoStarted?.();
    void dial();
    // `dial` is redefined every render; the ref is what keeps this to once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

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
