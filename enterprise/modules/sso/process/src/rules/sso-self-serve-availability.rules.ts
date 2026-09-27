// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { SsoSelfServeContext } from "@langwatch/enterprise-sso-contract";

/** Why setup is not available, in the vocabulary the refusal codes use. */
export type SsoSelfServeRefusal = "license_required" | "license_restart_required" | "not_opted_in";

export type SsoSelfServeAvailability =
  | { available: true }
  | { available: false; refusal: SsoSelfServeRefusal };

/**
 * Self-hosted: the licence held at startup decides; one activated since
 * startup asks for a restart. Hosted: the organization's opt-in decides.
 * Self-hosted is read first, because the opt-in is a hosted concept.
 */
export function ssoSelfServeAvailability(context: SsoSelfServeContext): SsoSelfServeAvailability {
  if (context.deployment === "self-hosted") {
    if (context.licensed) return { available: true };
    return {
      available: false,
      refusal: context.licenseActivatedSinceStart ? "license_restart_required" : "license_required",
    };
  }
  if (!context.optedIn) return { available: false, refusal: "not_opted_in" };
  return { available: true };
}
