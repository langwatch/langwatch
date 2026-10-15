/**
 * The per-organization lineage signal: moved when one of its projects changes team or is
 * archived, so a held project lineage is checked against it before it answers.
 */
export abstract class AuthzLineageEpochRepository {
  /** Null when the signal cannot be read: nothing is held and every lineage is read afresh. */
  abstract findEpoch(input: { organizationId: string }): Promise<number | null>;

  /** Throws when the signal cannot be moved, so the delivery that asked is retried. */
  abstract bump(input: { organizationId: string }): Promise<void>;
}
