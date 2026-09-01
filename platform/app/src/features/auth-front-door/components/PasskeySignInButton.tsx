import type { SignInMethod } from "@langwatch/identity";
import type { ReactNode } from "react";
import { useState } from "react";
import { authClient, navigate, safeRedirectTarget } from "~/utils/auth-client";
import { rememberLastUsedMethod } from "../logic/lastUsedMethod";
import { signInMethodActionLabel } from "../logic/methodLabels";
import { MethodButton } from "./MethodButton";
import { SignInMethodIcon } from "./SignInMethodIcon";

/** The client's name for the ceremony, so the mark and the words are drawn by
 *  the same two functions every other method on the rail is drawn by. */
const PASSKEY: SignInMethod = {
  id: "passkey",
  kind: "passkey",
  connectionId: null,
};

/**
 * What went wrong, in a code the registry has words for.
 *
 * The ceremony's own failures arrive from the WebAuthn client, which knows
 * nothing about our error vocabulary — so handed on as they are, every one of
 * them resolved to the generic unknown line ("Something went wrong. We've been
 * notified."). That line is for failures we could not anticipate, and this is
 * not one of them: a passkey attempt fails in two ways worth telling apart,
 * and both have been registered copy all along.
 *
 * The shape is the flat one a REST boundary sends (`{ error: "<code>" }`),
 * which `readHandledError` reads, so the alert resolves it exactly as it would
 * a refusal from the server.
 */
function passkeyFailure(status: number | undefined): { error: string } {
  // The server looked at the credential and said no. Same answer whether it
  // belongs to somebody else or to nobody — the endpoint does not say which.
  const refused = status === 400 || status === 401 || status === 403;
  return {
    error: refused
      ? "identity_passkey_not_recognized"
      : "identity_passkey_ceremony_failed",
  };
}

/**
 * Signing in with a passkey: the whole ceremony is the browser's, so this is
 * one button and the platform does the rest.
 *
 * No address is asked for and none is sent. A passkey names the account by
 * itself — that is what makes it a way IN rather than a second factor — so the
 * router deliberately learns nothing from this path, and neither does anybody
 * watching it: a discoverable credential prompt looks the same whether or not
 * this browser holds one for us.
 *
 * It wears the same seat as every provider beside it (`MethodButton`) and is
 * named the way they are — "Continue with a passkey", off the same
 * `signInMethodActionLabel` that writes "Continue with Google". A method that
 * announced itself differently would read as a different kind of offer, and it
 * is not one: it is the same door, opened by something already on the device.
 *
 * `rememberLastUsedMethod` is called on success rather than on the click. The
 * ceremony can be cancelled at the system prompt, and a badge that meant "last
 * dismissed" is the bug this screen already had once.
 *
 * A refusal is reported UP rather than drawn here. This button sits part-way
 * down a rail of methods, and an alert opening in the middle of that rail
 * pushes everything under it down and says its piece where nobody is looking.
 * The card has one place for "something went wrong", at the top, and every
 * failure on these screens belongs in it.
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
