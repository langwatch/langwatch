import { useState } from "react";
import { normalizeErrorCode } from "~/features/auth/logic/signInErrorCodes";
import { explainAnyError } from "~/features/errors/logic/presentation";
import { authClient, useSession } from "~/utils/auth-client";

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

/**
 * OUR OWN refusals, in the words an administrator can act on.
 *
 * THE SAME CODES THE PUBLIC SCREEN RENDERS, read by a different reader. The
 * sign-in error screen gets somebody who usually cannot fix any of this, so it
 * says which kind of thing is wrong and who to ask; this screen has the person
 * who owns the connection, already signed in, looking at the thing itself — so
 * it says what to change. One code, two audiences, no second server state to
 * keep in step (specs/identity/sso-assertion-refusals.feature).
 *
 * Without this, our own refusal was reported as "your identity provider sent
 * you back with an error" and the code quoted as if the provider had said it,
 * which sends an administrator off to debug a correctly configured provider.
 */
const OUR_REFUSALS: Record<
  string,
  { title: string; advice: (yourAddress: string | null) => string }
> = {
  OAuthAccountNotLinked: {
    title: "LangWatch couldn't link that sign-in to your account",
    advice: () =>
      "Check that your identity provider returned an address verified on your LangWatch account. If it did, ask your administrator to review the existing sign-in methods before trying again.",
  },
  sso_setup_address_mismatch: {
    // THE ONE THAT READS AS A CONTRADICTION IF IT NAMES THE WRONG THING.
    // The reader is doing the test sign-in that setup asked them for, so
    // "this connection is still being set up" tells them they cannot do the
    // thing they are being told to do. The cause is not the connection's
    // state — it is that the address their provider asserted is not the one
    // on the account that registered the connection.
    title: "Your identity provider signed you in as a different address",
    advice: (yourAddress) =>
      [
        "The sign-in worked. What it came back with was an address this connection cannot carry yet: until the domain is verified, the only one it accepts is the address on the LangWatch account that registered it",
        yourAddress ? ` — yours is ${yourAddress}` : "",
        ". Sign in at your identity provider as that address, or add the address your provider does use to your LangWatch account and verify it. Verifying the domain also fixes it, and opens the connection to everybody on it.",
      ].join(""),
  },
  sso_assertion_without_address: {
    title: "Your identity provider didn't send an email address",
    advice: () =>
      "It authenticated successfully and released no email address, so there is nothing to match to an account. Add the email scope or claim mapping to the application you created there, then run this again.",
  },
  sso_domain_not_verified: {
    title: "That address is on a domain this connection hasn't verified",
    advice: () =>
      "The domain proof is what lets us trust your provider's word that an address is real, so an address outside the verified domains is refused. Claim and verify that domain, or sign in with an address on one you have already verified.",
  },
  sso_domain_proof_lapsed: {
    title: "That domain's verification record has lapsed",
    advice: () =>
      "The published record stopped resolving, so the domain still signs in the people already using it and vouches for nobody new. Republish the record and we will pick it up — we have already asked for it to be checked again.",
  },
  sso_sign_in_refused: {
    title: "LangWatch refused that sign-in",
    advice: () =>
      "Your identity provider completed the sign-in and we would not accept it. The server log for this connection records the reason.",
  },
};

/**
 * The words for whatever came back, ours or the provider's.
 *
 * OURS FIRST. A refusal from our own gate arrives through the same `?error=`
 * the provider's own failures use, and attributing it to the provider names
 * the wrong culprit. We wrote these words, so there is nothing to quote: the
 * advice IS the detail.
 */
function failureFor({
  code,
  yourAddress,
}: {
  code: string;
  yourAddress: string | null | undefined;
}): TestSignInFailure {
  const ours = OUR_REFUSALS[normalizeErrorCode(code) ?? code];
  if (ours) {
    return {
      title: ours.title,
      detail: null,
      advice: ours.advice(yourAddress ?? null),
    };
  }

  const description =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("error_description");
  return {
    title: "Your identity provider sent you back with an error",
    detail: description ? `${code}: ${description}` : code,
    advice:
      "These are the provider's own words. Check them against the application you created there — the redirect address and the client values are the usual suspects.",
  };
}

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
  // WHAT CAME BACK, not the words for it. The copy for one of our own codes
  // names the reader's own address, which the session may not have handed us
  // yet on the render this state is first built — freezing a sentence here
  // meant the most useful half of it was permanently missing on a cold load.
  // So the verdict is stored and the words are derived below.
  const [callbackCode, setCallbackCode] = useState<string | null>(() => {
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
    return code;
  });

  const { data: session } = useSession();
  const callbackFailure = callbackCode
    ? failureFor({ code: callbackCode, yourAddress: session?.user?.email })
    : null;

  const start = async () => {
    setSending(true);
    // A new attempt clears the last one's verdict, so a stale failure can
    // never sit under a button that has just succeeded.
    setStartFailure(null);
    setCallbackCode(null);
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
      setCallbackCode(null);
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
