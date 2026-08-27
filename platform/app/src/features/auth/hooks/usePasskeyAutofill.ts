import { useEffect, useRef } from "react";
import { authClient, navigate, safeRedirectTarget } from "~/utils/auth-client";
import { rememberLastUsedMethod } from "../logic/lastUsedMethod";

/**
 * A ceremony nobody completed: the sheet was dismissed, the screen went away,
 * the request was superseded. WebAuthn reports a decline and an abort the same
 * way it reports "no credential matched", deliberately, and none of them are
 * events a person needs telling about.
 */
function wasDeclined(error: unknown): boolean {
  if (!(error instanceof DOMException)) return false;
  return error.name === "NotAllowedError" || error.name === "AbortError";
}

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
  onError,
}: {
  isLive: () => boolean;
  callbackUrl?: string;
  onError: (error: unknown) => void;
}): Promise<void> {
  try {
    const available =
      await window.PublicKeyCredential?.isConditionalMediationAvailable?.();
    if (!available || !isLive()) return;

    const result = await authClient.signIn.passkey({ autoFill: true });
    if (!isLive() || !result) return;

    // PICKING A PASSKEY IS STARTING SOMETHING. Up to here nobody had, and
    // silence was right. Past here somebody chose a credential and is waiting
    // for a door to open, so a refusal they never see reads as the click
    // having done nothing at all — which is exactly how this arrived: a
    // passkey the server no longer holds (`identity_passkey_not_recognized`)
    // was refused correctly, and the screen said nothing.
    if (result.error) {
      onError(result.error);
      return;
    }

    rememberLastUsedMethod({ id: "passkey" });
    navigate(safeRedirectTarget(callbackUrl));
  } catch (error) {
    // Still silent for the ones nobody finished, and only those.
    if (!isLive() || wasDeclined(error)) return;
    onError(error);
  }
}

/**
 * Offering a passkey from the address field itself, the way the platform
 * offers a saved password (WebAuthn conditional mediation).
 *
 * This is the recommended way in, ahead of any button: the credential appears
 * in the browser's own autofill list under the field somebody is already
 * looking at, so it is found by people who do not remember having made a
 * passkey — which research says is most of them. A dedicated button is the
 * fallback for a crowded screen, not the primary route.
 *
 * The address field has carried `autocomplete="username webauthn"` all along.
 * That token on its own does NOTHING: it tells the browser a passkey MAY be
 * offered there, and the browser only offers one while a conditional request
 * is actually pending. This is that request.
 *
 * It is an offer, not an attempt, and behaves like one:
 *
 *   - it asks first. A browser without conditional mediation is left alone
 *     rather than shown a modal prompt it did not ask for, which is what a
 *     plain `get()` would do.
 *   - it reports failure only once somebody PICKED a passkey. Until then
 *     nobody started this and nobody is owed an error — a person typing their
 *     address must not be interrupted by something they did not do. But
 *     choosing a credential IS starting something, and a refusal they never
 *     see reads as the click having done nothing at all, which is the bug
 *     this replaces. A dismissed sheet stays silent, being a decline.
 *   - it resolves only if somebody PICKS the passkey. Until then the promise
 *     simply waits, which is why there is no loading state anywhere near it.
 *   - it waits for a gesture. The request starts when the person actually
 *     reaches for the address field — a click or a keystroke — never on page
 *     load: a pending conditional request is supposed to be silent, but a
 *     third-party passkey provider (1Password, notably) answers it with its
 *     own unlock sheet the moment it starts, so starting it uninvited
 *     ambushes somebody who only came to read the page. Focus alone is NOT
 *     the gesture: the entrance focuses the address field programmatically
 *     (`useFocusWhenSettled`), and a focus the page gave itself is the page's
 *     intent, not the person's. The autofill list the credential rides in
 *     only shows under a focused field anyway, so arming this late costs
 *     nothing.
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
   * Told when a passkey somebody PICKED could not be used. Never told about
   * a request nobody answered, or one they dismissed.
   */
  onError?: (error: unknown) => void;
}): void {
  // Read after the await, like `isLive`: the ceremony may resolve a minute
  // after it started, and the caller may have handed us a new callback since.
  const report = useRef(onError);
  report.current = onError;

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
      target instanceof HTMLInputElement &&
      target.matches('input[autocomplete~="webauthn"]');

    const offerOnce = () => {
      if (offered || !live) return;
      offered = true;
      remove();
      void offerPasskeyFromAutofill({
        isLive: () => live,
        callbackUrl,
        onError: (error) => report.current?.(error),
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
      if (
        isWebauthnField(event.target) ||
        isWebauthnField(document.activeElement)
      ) {
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
