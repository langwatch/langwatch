import { useEffect, useRef } from "react";

import { rememberLastUsedMethod } from "../model/last-used-method.ts";
import {
  isCeremonyAbandoned,
  passkeyFailure,
  passkeyFailureFrom,
  readPasskeyErrorCode,
} from "../model/passkey-failure.ts";
import { authClient, navigate, safeRedirectTarget } from "./auth-client.tsx";

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
  } catch (error) {
    // A dismissed sheet throws too; only a ceremony that broke is reported.
    if (!isLive()) return;
    if (error instanceof DOMException && isCeremonyAbandoned({ name: error.name })) return;
    onError(passkeyFailure(void 0));
  }
}

const isWebauthnField = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement && target.matches('input[autocomplete~="webauthn"]');

/**
 * Calls onReach once, on the person's first gesture toward the address field,
 * and returns the stop. A gesture is a pointer or a key, never a focus: the
 * entrance focuses the field itself, and that must not start a ceremony.
 */
function watchForReach(onReach: () => void): () => void {
  let interacted = false;
  const reach = () => {
    stop();
    onReach();
  };
  // Tab arriving in the field: the keydown that moved focus set `interacted`.
  const onFocusIn = (event: FocusEvent) => {
    if (interacted && isWebauthnField(event.target)) reach();
  };
  // Only a click aimed at the field: Continue runs a ceremony of its own, and
  // two ceremonies on one challenge turn a good passkey down.
  const onPointerDown = (event: Event) => {
    interacted = true;
    if (isWebauthnField(event.target)) reach();
  };
  // A keystroke while already in the field counts: the entrance autofocuses it.
  const onKeyDown = (event: Event) => {
    interacted = true;
    if (isWebauthnField(event.target) || isWebauthnField(document.activeElement)) reach();
  };
  const stop = () => {
    document.removeEventListener("focusin", onFocusIn);
    document.removeEventListener("pointerdown", onPointerDown);
    document.removeEventListener("keydown", onKeyDown);
  };
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("keydown", onKeyDown);
  return stop;
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
    // leaves cannot cancel it; it can refuse to act on it. A sign-in that
    // worked navigates away (pagehide) before this door unmounts.
    let live = true;
    const leave = () => {
      live = false;
    };
    const stop = watchForReach(() => {
      void offerPasskeyFromAutofill({
        isLive: () => live,
        callbackUrl,
        onError: (error) => reportError.current?.(error),
      });
    });
    window.addEventListener("pagehide", leave);

    return () => {
      leave();
      stop();
      window.removeEventListener("pagehide", leave);
    };
  }, [enabled, callbackUrl]);
}
