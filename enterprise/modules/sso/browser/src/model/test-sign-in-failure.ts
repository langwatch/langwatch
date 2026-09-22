// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What a test sign-in came back with, in words its reader can act on. The
 * same codes the public sign-in screen renders, read by a different person:
 * that screen has somebody who cannot fix any of it, this one has the
 * administrator looking at the thing itself, so it says what to change.
 * Spec: specs/identity/sso-assertion-refusals.feature.
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

/**
 * OUR OWN refusals. Without these a refusal of ours was reported as "your
 * identity provider sent you back with an error", with our code quoted as if
 * the provider had said it — which sends an administrator off to debug a
 * correctly configured provider.
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
    // The one that reads as a contradiction if it names the wrong thing:
    // the reader is doing the test sign-in setup asked them for, so "this
    // connection is still being set up" tells them they may not do what
    // they are being told to do. The cause is narrower and fixable.
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
 * The words for whatever came back, ours or the provider's. OURS FIRST: a
 * refusal from our own gate arrives through the same `?error=` the
 * provider's failures use, and attributing it to the provider names the
 * wrong culprit. We wrote these words, so the advice IS the detail.
 *
 * The caller normalises the code and hands over the provider's description;
 * this reads nothing off the address bar.
 */
export function testSignInFailureFor({
  code,
  description,
  yourAddress,
}: {
  code: string;
  /** `error_description` as the provider sent it, where there is one. */
  description?: string | null;
  yourAddress?: string | null;
}): TestSignInFailure {
  const ours = OUR_REFUSALS[code];
  if (ours) {
    return { title: ours.title, detail: null, advice: ours.advice(yourAddress ?? null) };
  }

  return {
    title: "Your identity provider sent you back with an error",
    detail: description ? `${code}: ${description}` : code,
    advice:
      "These are the provider's own words. Check them against the application you created there — the redirect address and the client values are the usual suspects.",
  };
}

/** Whether the words are ours, which is the same as saying who to go and ask. */
export function testSignInFailureIsOurs(code: string): boolean {
  return code in OUR_REFUSALS;
}

/**
 * The refusal that came back before the browser ever left: not a handled
 * payload of ours, so there is no code to key copy off. The one thing the
 * administrator can act on is what was actually said, so it is quoted rather
 * than summarised away.
 */
export function testSignInStartFailure(refusal: {
  code?: string | undefined;
  message?: string | undefined;
  statusText?: string | undefined;
  status?: number | undefined;
}): TestSignInFailure {
  const detail =
    [
      refusal.code,
      refusal.message ?? refusal.statusText,
      refusal.status ? `(status ${refusal.status})` : null,
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
