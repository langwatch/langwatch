// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Which tier an organization gets when it sets single sign-on up itself
 * (D05, specs/identity/sso-onboarding-tiers.feature).
 */
import { z } from "zod";

export const SSO_SELF_SERVE_DEPLOYMENTS = ["hosted", "self-hosted"] as const;

export const ssoSelfServeContextSchema = z.object({
  deployment: z.enum(SSO_SELF_SERVE_DEPLOYMENTS),
  /** The frozen licence gate, and only where a licence can speak at all. */
  licensed: z.boolean(),
  /**
   * A genuine licence is active now, but was not when this process started.
   * The honest half of the restart story: it is what lets the page say
   * "restart" rather than "no licence", which are very different things to be
   * told when you have just paid.
   */
  licenseActivatedSinceStart: z.boolean(),
  /** Hosted self-serve, which is opted into per organization. */
  optedIn: z.boolean(),
  /** Self-hosted only: the installation holds exactly one organization. */
  singleOrganization: z.boolean(),
  /** Whether the person asking is a platform operator (ADMIN_EMAILS); asked only
   *  where it changes the answer. */
  actorIsPlatformOperator: z.boolean(),
});

export type SsoSelfServeContext = z.infer<typeof ssoSelfServeContextSchema>;

export const SSO_SELF_SERVE_REFUSALS = [
  "license_required",
  "license_restart_required",
  "not_opted_in",
] as const;

/** How a claimed domain is proved: the installation's licence, or a published record. */
export const SSO_SELF_SERVE_PROOFS = ["license-token", "dns-txt"] as const;

/** Whether setup is open to this organization, or the one thing that would change that. */
export const ssoSelfServeAvailabilitySchema = z.discriminatedUnion("available", [
  z.object({ available: z.literal(true), proof: z.enum(SSO_SELF_SERVE_PROOFS) }).strict(),
  z.object({ available: z.literal(false), refusal: z.enum(SSO_SELF_SERVE_REFUSALS) }).strict(),
]);

export type SsoSelfServeAvailability = z.infer<typeof ssoSelfServeAvailabilitySchema>;
