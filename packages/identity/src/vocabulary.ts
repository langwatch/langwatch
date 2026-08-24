import { z } from "zod";

/**
 * The identity vocabulary (ADR-101, D01): what an identifier is called, the
 * states it moves through, and the two arrival rules everything else rests
 * on. Pure data and pure functions, so the sign-in screens (D13) and the
 * server read the same words.
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
export type IdentifierLifecycleState =
  (typeof IDENTIFIER_LIFECYCLE_STATES)[number];

/**
 * An identifier arrives ATTACHED or VERIFIED, never further along:
 * OAuth/SSO ceremonies and account-control providers (credential, passkey)
 * arrive VERIFIED (R8 — the ceremony itself is the proof), `email` arrives
 * ATTACHED and verifies via the magic-link ceremony. PRIMARY, DEAD_END and
 * DETACHED are transitions, not arrivals — each has its own event.
 */
export const identifierArrivalStateSchema = z.enum(["ATTACHED", "VERIFIED"]);
export type IdentifierArrivalState = z.infer<
  typeof identifierArrivalStateSchema
>;

export const verificationMethodSchema = z.enum([
  "magic-link",
  "oauth",
  "saml",
  "creation",
]);
export type VerificationMethod = z.infer<typeof verificationMethodSchema>;

export const identityActorSchema = z.object({
  type: z.enum(["user", "system"]),
  id: z.string().nullable(),
});
export type IdentityActor = z.infer<typeof identityActorSchema>;

/**
 * R8 arrival semantics: OAuth/SSO ceremonies arrive VERIFIED (the ceremony
 * is the proof), credential/passkey are verified at creation (account
 * control, not mailbox), `email` arrives ATTACHED and verifies via the
 * magic-link ceremony. Legacy-migration providers arrive VERIFIED — D09
 * migrates only established sign-ins.
 */
export function arrivalStateForProvider(
  provider: IdentifierProvider,
): IdentifierArrivalState {
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
 * ATTACHED, VERIFIED or PRIMARY: a row that still holds its value for the
 * user. DEAD_END and DETACHED are tombstones.
 *
 * The list and the predicate live together on purpose — a repository needs
 * the list for a SQL `IN`, everything else needs the predicate, and two
 * hand-maintained copies would eventually disagree about whether a tombstone
 * can sign someone in.
 */
export const LIVE_IDENTIFIER_STATES = [
  "ATTACHED",
  "VERIFIED",
  "PRIMARY",
] as const satisfies readonly IdentifierLifecycleState[];

export function isLiveIdentifierState(state: string): boolean {
  return (LIVE_IDENTIFIER_STATES as readonly string[]).includes(state);
}
