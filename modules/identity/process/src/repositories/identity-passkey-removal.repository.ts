import type { IdentityUserGate } from "../rules/identity-user-gate.rules.ts";

export type PasskeyRemovalOutcome = "deleted" | "not_found" | "would_strand_user";

/**
 * The atomic persistence boundary behind better-auth's one-passkey delete. Decision and deletion
 * share one serializable transaction: two removals reading the same stale set could both proceed.
 * `routesToIdentity` picks where the user's credentials live (`AccountCredential` once latched).
 */
export abstract class IdentityPasskeyRemovalRepository {
  abstract deleteIfAnotherWayInRemains(args: {
    passkeyId: string;
    routesToIdentity: IdentityUserGate;
  }): Promise<PasskeyRemovalOutcome>;
}
