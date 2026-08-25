import type { SignInMethod } from "@langwatch/identity";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { authClient, navigate, safeRedirectTarget } from "~/utils/auth-client";
import { rememberLastUsedMethod } from "../logic/lastUsedMethod";
import { signInMethodActionLabel } from "../logic/methodLabels";
import {
  endPasskeyCeremony,
  startPasskeyCeremony,
} from "../logic/passkeyCeremony";
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
  autoStart = false,
  onAutoStarted,
  onError,
  onDeclined,
}: {
  callbackUrl?: string;
  /** "Last used", where this browser remembers getting in this way. */
  badge?: ReactNode;
  /**
   * Start the ceremony as soon as the button appears (ADR-117, revision
   * 2026-08-25). Set only where the person submitted an identifier that routed
   * to a passkey-holding account, which is the gesture the ceremony answers —
   * never on a rail of methods somebody is merely reading.
   */
  autoStart?: boolean;
  /**
   * The automatic ceremony has been started, told to whoever owns the SCREEN.
   *
   * The guard against starting a second one cannot live in this component: a
   * ceremony takes the whole card, so this button is unmounted while its own
   * prompt is up and remounted when the panel comes down — and a remounted
   * component has a fresh ref and would start again. The one thing that
   * outlives that is the screen, so the screen remembers.
   */
  onAutoStarted?: () => void;
  /** Where a refusal goes: the card's alert, at the top. */
  onError: (error: unknown) => void;
  /**
   * The ceremony ended and nobody is signed in — refused, cancelled, or the
   * prompt closed. Told so the screen can fall to the next-best method with
   * the retry beside it, rather than leaving somebody looking at a passkey
   * that has just declined to work.
   */
  onDeclined?: () => void;
}) {
  const [isBusy, setIsBusy] = useState(false);
  /**
   * Whether the attempt currently in flight still matters.
   *
   * The plugin hands out no abort handle, so cancelling cannot stop the
   * browser's prompt — what it CAN do is make the screen stop acting on it. A
   * navigation fired from a ceremony somebody has already walked away from
   * takes them somewhere they did not ask to go.
   */
  const attempt = useRef<{ abandoned: boolean } | null>(null);

  const dial = () => {
    onError(null);
    setIsBusy(true);
    const current = { abandoned: false };
    attempt.current = current;
    startPasskeyCeremony({
      purpose: "sign-in",
      cancel: () => {
        current.abandoned = true;
        setIsBusy(false);
        // Cancelling IS declining. The screen owes them the other ways in.
        onDeclined?.();
      },
      retry: dial,
    });
    void run(current);
  };

  // One automatic attempt, on the first paint that asks for one. The ref stops
  // a re-render restarting it, and `onAutoStarted` stops a REMOUNT doing the
  // same — this component is unmounted while its own ceremony holds the card,
  // so the ref alone would be reset by the panel coming down.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoStart || autoStarted.current) return;
    autoStarted.current = true;
    onAutoStarted?.();
    dial();
    // `dial` is redefined every render and re-running this is exactly what the
    // ref above exists to prevent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  const run = async (current: { abandoned: boolean }) => {
    try {
      const result = await authClient.signIn.passkey();
      if (current.abandoned) return;
      // A cancelled prompt is not a failure worth shouting about: the person
      // closed it, and the other methods are still on the screen behind this.
      // But ONLY the explicit abort is a cancel. A client-side failure — the
      // authenticator erroring, a relying-party mismatch — also comes back
      // with no status, and silencing it left somebody whose passkey FAILED
      // staring at a screen that said nothing at all.
      if (result?.error) {
        const cancelled =
          "code" in result.error &&
          result.error.code === "ERROR_CEREMONY_ABORTED";
        if (!cancelled) {
          onError(
            passkeyFailure(
              result.error.status === 0 ? void 0 : result.error.status,
            ),
          );
        }
        // Told either way, quiet refusal included: the screen's job now is to
        // offer the next-best method, and that is as true of a prompt somebody
        // closed as of one the server turned down.
        onDeclined?.();
        return;
      }
      rememberLastUsedMethod({ id: "passkey" });
      navigate(safeRedirectTarget(callbackUrl));
    } catch {
      // A throw from the WebAuthn client — unsupported, an insecure origin, a
      // ceremony that never got started. It never reached the server, so there
      // is no status to read and nothing to tell apart.
      if (!current.abandoned) {
        onError(passkeyFailure(void 0));
        onDeclined?.();
      }
    } finally {
      if (!current.abandoned) {
        setIsBusy(false);
        endPasskeyCeremony();
      }
    }
  };

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
