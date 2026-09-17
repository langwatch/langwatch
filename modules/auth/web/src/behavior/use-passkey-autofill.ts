import { useEffect, useRef } from "react";
import { authClient, navigate, safeRedirectTarget } from "./auth-client.tsx";
import { rememberLastUsedMethod } from "../model/last-used-method.ts";
import {
  isCeremonyAbandoned,
  passkeyFailureFrom,
  readPasskeyErrorCode,
} from "../model/passkey-failure.ts";

/**
 * The waiting half: ask whether the browser can do this, then leave a
 * request pending for as long as the screen lives. `isLive` is read (not
 * passed) since it's checked AFTER the await, when the door may have closed.
 */
async function offerPasskeyFromAutofill({
  isLive,
  callbackUrl,
  onError,
}: {
  isLive: () => boolean;
  callbackUrl?: string;
  onError: (error: unknown) => void;
}): Promise<void> {
  try {
    const available = await window.PublicKeyCredential?.isConditionalMediationAvailable?.();
    if (!available || !isLive()) return;

    const result = await authClient.signIn.passkey({ autoFill: true });
    if (!isLive() || !result) return;

    // Past this point somebody PICKED a credential, so a refusal they never
    // see reads as the click doing nothing. The plugin RESOLVES an abandoned
    // ceremony (doesn't throw) carrying a 400 — same as a real "no" from the
    // server — so only a genuine refusal is reported, an abandoned one stays silent.
    if (result.error) {
      if (!isCeremonyAbandoned({ code: readPasskeyErrorCode(result.error) })) {
        onError(passkeyFailureFrom(result.error));
      }
      return;
    }

    rememberLastUsedMethod({ id: "passkey" });
    navigate(safeRedirectTarget(callbackUrl));
  } catch {
    // Silent by design. Nobody started this, so nobody is owed an error.
    return;
  }
}

/**
 * WebAuthn conditional mediation for passkey autofill; starts on gesture, not load
 */
export function usePasskeyAutofill({
  enabled,
  callbackUrl,
  onError,
}: {
  /** Only where this deployment actually offers passkeys. */
  enabled: boolean;
  callbackUrl?: string;
  /**
   * Told when a passkey somebody PICKED could not be used. Never told about a
   * request nobody answered, or one they dismissed.
   */
  onError?: (error: unknown) => void;
}): void {
  // Read after the await, like `isLive`: the ceremony may resolve a minute
  // after it started, and the caller may have handed us a new callback since.
  const reportError = useRef(onError);
  reportError.current = onError;

  useEffect(() => {
    if (!enabled) return;

    // The ceremony has no abort handle through the plugin, so a screen that
    // leaves cannot cancel the request it started. What it can do is refuse to
    // act on it: a navigation fired from an unmounted door would take somebody
    // somewhere they had already left.
    let live = true;
    let offered = false;
    // A gesture is a pointer or a key, not a focus: the entrance focuses the
    // field programmatically, and that must not start a ceremony.
    let interacted = false;

    const isWebauthnField = (target: EventTarget | null): boolean =>
      target instanceof HTMLInputElement && target.matches('input[autocomplete~="webauthn"]');

    const offerOnce = () => {
      if (offered || !live) return;
      offered = true;
      remove();
      void offerPasskeyFromAutofill({
        isLive: () => live,
        callbackUrl,
        onError: (error) => reportError.current?.(error),
      });
    };

    const onFocusIn = (event: FocusEvent) => {
      // Tab arriving in the field: the keydown that moved focus set
      // `interacted`, and this focus is the person landing.
      if (interacted && isWebauthnField(event.target)) offerOnce();
    };

    const onGesture = (event: Event) => {
      interacted = true;
      // A click straight into the field, or a keystroke while already in it
      // (the entrance autofocuses, so typing is often the FIRST gesture).
      if (isWebauthnField(event.target) || isWebauthnField(document.activeElement)) {
        offerOnce();
      }
    };

    const remove = () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("pointerdown", onGesture);
      document.removeEventListener("keydown", onGesture);
    };

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("pointerdown", onGesture);
    document.addEventListener("keydown", onGesture);

    return () => {
      live = false;
      remove();
    };
  }, [enabled, callbackUrl]);
}
