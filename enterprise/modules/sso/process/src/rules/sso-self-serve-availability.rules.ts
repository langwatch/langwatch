// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  SsoSelfServeAvailability,
  SsoSelfServeContext,
} from "@langwatch/enterprise-sso-contract";

/**
 * Self-hosted: the licence gate decides; a licence the gate has not read yet
 * says it is on its way. Hosted: the organization's opt-in decides.
 * Self-hosted is read first, because the opt-in is a hosted concept.
 */
export function ssoSelfServeAvailability(context: SsoSelfServeContext): SsoSelfServeAvailability {
  if (context.deployment === "self-hosted") {
    if (context.licensed) {
      // The installation's operator already decides who has an account on it, so a
      // record proves nothing they could not do anyway; with several organizations
      // an organization administrator is not that operator.
      const licenseProves = context.singleOrganization || context.actorIsPlatformOperator;
      return { available: true, proof: licenseProves ? "license-token" : "dns-txt" };
    }
    return {
      available: false,
      refusal: context.licenseActivationPending ? "license_activation_pending" : "license_required",
    };
  }
  if (!context.optedIn) return { available: false, refusal: "not_opted_in" };
  return { available: true, proof: "dns-txt" };
}
