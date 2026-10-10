import type { SignInMethod } from "@langwatch/identity-contract";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { authClient, navigate, safeRedirectTarget } from "../../behavior/auth-client.tsx";
import { endPasskeyCeremony, startPasskeyCeremony } from "../../behavior/passkey-ceremony.store.ts";
import { rememberLastUsedMethod } from "../../model/last-used-method.ts";
import { signInMethodActionLabel } from "../../model/method-labels.ts";
import {
  isCeremonyAbandoned,
  passkeyFailure,
  passkeyFailureFrom,
  readPasskeyErrorCode,
} from "../../model/passkey-failure.ts";
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
  // Cancelling cannot stop the browser's prompt, so it makes the screen stop acting on it.
  const attempt = useRef<{ abandoned: boolean } | null>(null);

  const setBusy = (next: boolean) => {
    setIsBusy(next);
    onBusyChange?.(next);
  };

  const dial = () => {
    onError(null);
    setBusy(true);
    if (attempt.current) attempt.current.abandoned = true;
    const current = { abandoned: false };
    attempt.current = current;
    startPasskeyCeremony({
      purpose: "sign-in",
      cancel: () => {
        current.abandoned = true;
        setBusy(false);
        onDeclined?.();
      },
      retry: dial,
    });
    void run(current);
  };

  const run = async (current: { abandoned: boolean }) => {
    try {
      const result = await authClient.signIn.passkey();
      if (current.abandoned) return;
      // A cancelled prompt is not a failure worth shouting about: the person
      // closed it, and the other methods are still on the screen behind this.
      if (result?.error) {
        const abandoned = isCeremonyAbandoned({ code: readPasskeyErrorCode(result.error) });
        if (result.error.status !== 0 && !abandoned) onError(passkeyFailureFrom(result.error));
        onDeclined?.();
        return;
      }
      rememberLastUsedMethod({ id: "passkey" });
      navigate(safeRedirectTarget(callbackUrl));
    } catch {
      // A throw from the WebAuthn client never reached the server: no status to read.
      if (current.abandoned) return;
      onError(passkeyFailure(void 0));
      onDeclined?.();
    } finally {
      // A ceremony somebody walked away from releases nothing it no longer owns.
      if (!current.abandoned) {
        setBusy(false);
        endPasskeyCeremony();
      }
    }
  };

  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoStart || autoStarted.current) return;
    autoStarted.current = true;
    onAutoStarted?.();
    dial();
    // `dial` is redefined every render; the ref is what keeps this to once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  return (
    <MethodButton
      icon={<SignInMethodIcon method={PASSKEY} />}
      label={signInMethodActionLabel(PASSKEY)}
      badge={badge}
      isBusy={isBusy}
      onClick={dial}
      testId="passkey-sign-in"
    />
  );
}
