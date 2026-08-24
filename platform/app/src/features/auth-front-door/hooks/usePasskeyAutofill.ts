import { useEffect } from "react";
import { authClient, navigate, safeRedirectTarget } from "~/utils/auth-client";
import { rememberLastUsedMethod } from "../logic/lastUsedMethod";

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
    const available =
      await window.PublicKeyCredential?.isConditionalMediationAvailable?.();
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
 *   - it never reports failure. Nobody started this, so nobody is owed an
 *     error about it — a person typing their address must not be interrupted
 *     by something they did not do.
 *   - it resolves only if somebody PICKS the passkey. Until then the promise
 *     simply waits, which is why there is no loading state anywhere near it.
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

    void offerPasskeyFromAutofill({
      isLive: () => live,
      callbackUrl,
    });

    return () => {
      live = false;
    };
  }, [enabled, callbackUrl]);
}
