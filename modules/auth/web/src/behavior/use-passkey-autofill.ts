import { useEffect } from "react";
import { authClient, navigate, safeRedirectTarget } from "./auth-client.tsx";
import { rememberLastUsedMethod } from "../model/last-used-method.ts";

/**
 * The waiting half: ask whether the browser can do this at all, then leave a
 * request pending for as long as the screen lives.
 *
 * `isLive` is read rather than passed, because it is read AFTER the await —
 * the whole point is to know whether the door is still open when somebody
 * finally picks a passkey, which may be a minute later.
 */
async function offerPasskeyFromAutofill({
  isLive,
  callbackUrl,
}: {
  isLive: () => boolean;
  callbackUrl?: string;
}): Promise<void> {
  try {
    const available = await window.PublicKeyCredential?.isConditionalMediationAvailable?.();
    if (!available || !isLive()) return;

    const result = await authClient.signIn.passkey({ autoFill: true });
    if (!isLive() || !result || result.error) return;

    rememberLastUsedMethod({ id: "passkey" });
    navigate(safeRedirectTarget(callbackUrl));
  } catch {
    // Silent by design. Nobody started this, so nobody is owed an error.
  }
}

/**
 * WebAuthn conditional mediation for passkey autofill; starts on gesture, not load
 */
export function usePasskeyAutofill({
  enabled,
  callbackUrl,
}: {
  /** Only where this deployment actually offers passkeys. */
  enabled: boolean;
  callbackUrl?: string;
}): void {
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
