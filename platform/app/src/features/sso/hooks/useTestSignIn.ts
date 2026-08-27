import { useState } from "react";
import { explainAnyError } from "~/features/errors/logic/presentation";
import { authClient } from "~/utils/auth-client";

/**
 * The query parameter that says an `?error=` on this page belongs to a test
 * sign-in, and to WHICH connection's.
 *
 * `error`/`error_description` is the shape every OAuth bounce uses, and this
 * hook lives on ordinary app routes that other flows land on — so without a
 * marker of our own, any error parameter on the page was reported as the
 * identity provider bouncing this test back, quoting somebody else's code.
 */
const TEST_SIGN_IN_MARKER = "ssoTest";

/** Where the provider returns to: this page, marked as this test's. */
const testSignInCallbackUrl = (connectionId: string): string => {
  const here = new URL(window.location.href);
  // Any verdict on the URL now is about to be replaced by this attempt's.
  here.searchParams.delete("error");
  here.searchParams.delete("error_description");
  here.searchParams.set(TEST_SIGN_IN_MARKER, connectionId);
  return here.toString();
};

/**
 * Sending yourself to the identity provider and back, from anywhere that
 * offers it.
 *
 * The sign-in NAMES THE CONNECTION rather than going through the auth screens,
 * and that is what makes it possible before the organization's sign-in has
 * been switched over: proving the connection has to be something an
 * administrator can do while nothing about anybody else's sign-in has changed.
 *
 * A hook rather than a component, because two surfaces offer the same act with
 * different chrome around it — a step in the setup journey, and a control on
 * the overview — and the one thing that must not differ between them is what
 * pressing it does.
 *
 * THE FAILURE CARRIES ITS DETAIL. This is an administrator debugging their
 * own connection, not an end user signing in, so hiding the provider's words
 * behind "check the values" leaves them with nothing to check against. Both
 * failure surfaces — the request refused before redirecting, and the provider
 * bouncing the browser back with an error — hand the actual words over.
 *
 * AND IT IS HANDED BACK, NOT TOASTED. A toast is the wrong container for the
 * one thing on the screen the reader has to work from: it is gone in eight
 * seconds, it cannot be copied comfortably, it cannot be re-read, and it
 * sits nowhere near the connection it is about. The hook returns the failure
 * and each surface renders it beside its own button, on the card naming the
 * connection that produced it.
 */

/** What went wrong, and whether it happened here or at the other end. */
export interface TestSignInFailure {
  /** The headline, in our words. */
  title: string;
  /** The provider's own words, verbatim — the part worth copying. */
  detail: string | null;
  /** What to check, given where the failure came from. */
  advice: string;
}

export function useTestSignIn({ connectionId }: { connectionId: string }) {
  const [sending, setSending] = useState(false);
  const [startFailure, setStartFailure] = useState<TestSignInFailure | null>(
    null,
  );
  // What the identity provider bounced the browser back with, read once off
  // the URL the callback returned us to (`error` / `error_description` are
  // the OAuth error shape better-auth passes through). State rather than a
  // render-time read so a client-side navigation clears it naturally.
  const [callbackFailure, setCallbackFailure] =
    useState<TestSignInFailure | null>(() => {
      if (typeof window === "undefined") return null;
      const params = new URLSearchParams(window.location.search);
      const code = params.get("error");
      if (!code) return null;
      // OURS, or somebody else's. `error`/`error_description` is the shape
      // every OAuth bounce uses, and this hook is mounted on ordinary app
      // routes that other flows land on — the auth error page and the generic
      // callback both read the same keys. Without a marker of our own, any
      // `?error=` on the page was reported to an administrator as "your
      // identity provider sent you back with an error", quoting somebody
      // else's code at them.
      if (params.get(TEST_SIGN_IN_MARKER) !== connectionId) return null;
      const description = params.get("error_description");
      return {
        title: "Your identity provider sent you back with an error",
        detail: description ? `${code}: ${description}` : code,
        advice:
          "These are the provider's own words. Check them against the application you created there — the redirect address and the client values are the usual suspects.",
      };
    });

  const start = async () => {
    setSending(true);
    // A new attempt clears the last one's verdict, so a stale failure can
    // never sit under a button that has just succeeded.
    setStartFailure(null);
    setCallbackFailure(null);
    try {
      const { error } = await authClient.signIn.sso({
        providerId: connectionId,
        // Back to this page, so the result is the first thing they see —
        // carrying the marker that says an error on it is THIS test's.
        callbackURL: testSignInCallbackUrl(connectionId),
      });
      if (error) setStartFailure(startFailureFrom(error));
    } catch (error) {
      const copy = explainAnyError(error);
      setStartFailure({
        title: copy.title,
        detail: null,
        advice: copy.description,
      });
    } finally {
      setSending(false);
    }
  };

  return {
    start,
    sending,
    /** The most recent verdict, whichever half of the round trip produced
     *  it. One slot, because one of them is always the newer. */
    failure: startFailure ?? callbackFailure,
    dismissFailure: () => {
      setStartFailure(null);
      setCallbackFailure(null);
    },
  };
}

/**
 * Not a handled payload: this comes back from the identity provider or from
 * the engine talking to it, so there is no code of ours to key copy off. The
 * one thing the administrator can act on is what was actually said, so it is
 * quoted rather than summarised away.
 */
function startFailureFrom(error: {
  code?: string | undefined;
  message?: string | undefined;
  statusText?: string;
  status?: number;
}): TestSignInFailure {
  const detail =
    [
      error.code,
      error.message ?? error.statusText,
      error.status ? `(status ${error.status})` : null,
    ]
      .filter(Boolean)
      .join(" — ") || null;
  return {
    title: "That sign-in didn't complete",
    detail,
    advice: detail
      ? "Your identity provider turned the request away. Check the values you gave us against the application you created there, then try again."
      : "Your identity provider turned the request away before saying anything. Check the issuer address you gave us, then try again.",
  };
}
