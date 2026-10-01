// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { ProviderSignInError } from "@langwatch/enterprise-governance-contract";

import { type ListingRefusal, refusalFromThrown } from "./provider-listing.rules.ts";

/** A sign-in verdict as a listing refusal: a wrong secret reads as unauthorized, not the network. */
export function refusalFromSignIn(error: ProviderSignInError): ListingRefusal {
  if (error.reason === "not_configured") return { reason: "not_configured", status: null };
  if (error.reason === "malformed_response") {
    return { reason: "malformed_response", status: null };
  }
  const status = error.status;
  if (status === 401 || status === 403 || status === null) {
    return { reason: "unauthorized", status };
  }
  return { reason: "unavailable", status };
}

/**
 * A throw from a provider call, without guessing: a sign-in verdict is kept, anything else came
 * out of the transport and lands on `unreachable` — a retry, never an access-control audit.
 */
export function refusalFromListingThrow(error: unknown): ListingRefusal {
  if (error instanceof ProviderSignInError) return refusalFromSignIn(error);
  return refusalFromThrown(error);
}
