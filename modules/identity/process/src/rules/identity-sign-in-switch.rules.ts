import { type Instant, Temporal } from "@langwatch/time";

/** Identity's own row for the user. */
export type OwnSignInSwitchRow = Readonly<{ onIdentifiers: boolean; switchedAt: Instant }>;

/** The row an older image, or the legacy runner and rollback, still write in ops' state table. */
export type LegacySignInStateRow = Readonly<{ status: string; occurredAt: Instant }>;

/**
 * Whether the user signs in on the identifier path. The newer of the two rows answers, identity's
 * own on a tie, as licensing's licence rows do while both are written (ARCHITECTURE.md §7).
 * Spec: modules/identity/specs/sign-in-switch.feature.
 */
export function isOnIdentifierPath({
  own,
  legacy,
}: {
  own: OwnSignInSwitchRow | null;
  legacy: LegacySignInStateRow | null;
}): boolean {
  if (own && (!legacy || Temporal.Instant.compare(own.switchedAt, legacy.occurredAt) >= 0)) {
    return own.onIdentifiers;
  }
  return legacy?.status === "finalized";
}
