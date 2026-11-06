import { describeSignInIdp } from "@langwatch/identity-contract";

import type { SignInRefusalCopy } from "./sign-in-error-code.ts";

/**
 * What a refused sign-in says. The screen is reachable by anybody with a crafted address, so it
 * names only the kind of provider (from an allowlist), never an organization or a person.
 * @see specs/identity/idp-refused-sign-in.feature
 */

/** The access-denied card: the provider refused, not LangWatch, and who can change that. */
export function describeProviderRefusal(idp: string | null | undefined): SignInRefusalCopy {
  const name = describeSignInIdp(idp);
  return {
    title: "Sign-in was refused",
    body: name
      ? `Your company sign-in (${name}) refused this sign-in, not LangWatch. Ask your IT team to assign you the LangWatch app in ${name}.`
      : "Your company's sign-in refused this sign-in, not LangWatch. Ask your IT team to assign you the LangWatch app.",
  };
}

export const SEAT_LIMIT_REFUSAL: SignInRefusalCopy = {
  title: "Waiting for a seat",
  body: "Your organization is over its seat limits. Please contact an administrator to approve your access.",
};
