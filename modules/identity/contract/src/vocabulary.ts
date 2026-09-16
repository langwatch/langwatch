import { z } from "zod";

/**
 * The identity vocabulary (ADR-101, D01): what an identifier is called, its
 * states, and the two arrival rules everything rests on. Pure data and
 * functions, so sign-in screens (D13) and the server read the same words.
 */

/** The widened provider vocabulary (D01). `auth0-legacy` / `okta-legacy`
 *  exist for D09's per-customer migrations — nothing emits them yet. */
export const IDENTIFIER_PROVIDERS = [
  "credential",
  "email",
  "passkey",
  "google",
  "github",
  "gitlab",
  "azure-ad",
  "oidc",
  "saml",
  "auth0-legacy",
  "okta-legacy",
] as const;
export const identifierProviderSchema = z.enum(IDENTIFIER_PROVIDERS);
export type IdentifierProvider = z.infer<typeof identifierProviderSchema>;

export const IDENTIFIER_LIFECYCLE_STATES = [
  "ATTACHED",
  "VERIFIED",
  "PRIMARY",
  "DEAD_END",
  "DETACHED",
] as const;
export type IdentifierLifecycleState = (typeof IDENTIFIER_LIFECYCLE_STATES)[number];

/**
 * An identifier arrives ATTACHED or VERIFIED, never further along (R8):
 * OAuth/SSO and account-control providers arrive VERIFIED, `email` arrives
 * ATTACHED. PRIMARY, DEAD_END, DETACHED are transitions, not arrivals.
 */
export const identifierArrivalStateSchema = z.enum(["ATTACHED", "VERIFIED"]);
export type IdentifierArrivalState = z.infer<typeof identifierArrivalStateSchema>;

export const verificationMethodSchema = z.enum(["magic-link", "oauth", "saml", "creation"]);
export type VerificationMethod = z.infer<typeof verificationMethodSchema>;

export const identityActorSchema = z.object({
  type: z.enum(["user", "system"]),
  id: z.string().nullable(),
});
export type IdentityActor = z.infer<typeof identityActorSchema>;

/**
 * R8 arrival semantics (see {@link IdentifierArrivalState}): only `email`
 * arrives ATTACHED; legacy-migration providers arrive VERIFIED too, since
 * D09 migrates only established sign-ins.
 */
export function arrivalStateForProvider(provider: IdentifierProvider): IdentifierArrivalState {
  return provider === "email" ? "ATTACHED" : "VERIFIED";
}

/** better-auth providerIds → the identifier provider vocabulary (D01). */
export function identifierProviderFor(providerId: string): IdentifierProvider {
  switch (providerId) {
    case "credential":
      return "credential";
    case "google":
      return "google";
    case "github":
      return "github";
    case "gitlab":
      return "gitlab";
    case "microsoft":
    case "azure-ad":
      return "azure-ad";
    default:
      // Generic OAuth / enterprise IdPs (auth0, okta, custom OIDC) all
      // arrive through the oidc bucket until D04 gives them connections.
      return "oidc";
  }
}

/**
 * Live states (ATTACHED, VERIFIED, PRIMARY); DEAD_END and DETACHED are tombstones.
 * Adding a state requires updating migration 20260824120004's PARTIAL UNIQUE INDEX predicate
 * together—migrations can't import constants, so both must change in the same PR.
 */
export const LIVE_IDENTIFIER_STATES = [
  "ATTACHED",
  "VERIFIED",
  "PRIMARY",
] as const satisfies readonly IdentifierLifecycleState[];

export function isLiveIdentifierState(state: string): boolean {
  return (LIVE_IDENTIFIER_STATES as readonly string[]).includes(state);
}
