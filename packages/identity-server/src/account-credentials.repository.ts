/**
 * The credential half of a sign-in method (ADR-116): the secrets better-auth
 * needs and the event log must never carry.
 *
 * Row-truth, permanently. `access_token`, `refresh_token`, `id_token` and
 * `password` are forbidden in events by ADR-101's payload rule, and OAuth
 * refresh rewrites them on a cadence no event log should record. This is not
 * a stage on the way to event-sourcing everything — it is where that data
 * belongs. What ADR-116 moved OUT of here is the linkage, which
 * `Identifier` now owns alone.
 *
 * `id` is the identifier's `accountId` — the old `Account.id` — so a row
 * here is addressable by the id better-auth already holds.
 */
export interface AccountCredentialRow {
  id: string;
  identifierId: string;
  type: string;
  accessToken: string | null;
  refreshToken: string | null;
  idToken: string | null;
  password: string | null;
  scope: string | null;
  tokenType: string | null;
  sessionState: string | null;
  expiresAtMs: number | null;
  extExpiresIn: number | null;
  createdAtMs: number;
  updatedAtMs: number;
}

/** What a write may change. Anything absent is left alone. */
export type AccountCredentialPatch = Partial<
  Omit<AccountCredentialRow, "id" | "identifierId" | "createdAtMs" | "updatedAtMs">
>;

export interface AccountCredentialsRepository {
  findById(args: { id: string }): Promise<AccountCredentialRow | null>;
  /** Every credential for these identifiers, in one read — the list path. */
  findByIdentifierIds(args: {
    identifierIds: string[];
  }): Promise<AccountCredentialRow[]>;
  /**
   * Create the row the ceremony's identifier implies, or leave a colliding
   * one standing. Idempotent on `id` because the ceremony that precedes it
   * is: a retried sign-up derives the same identifier and the same id.
   */
  create(
    row: Omit<AccountCredentialRow, "createdAtMs" | "updatedAtMs">,
  ): Promise<void>;
  /** A token refresh or a password change — never an event. */
  update(args: { id: string; patch: AccountCredentialPatch }): Promise<void>;
  /** The same patch across several rows (better-auth's password reset). */
  updateMany(args: {
    ids: string[];
    patch: AccountCredentialPatch;
  }): Promise<number>;
  deleteByIds(args: { ids: string[] }): Promise<number>;
}
