import {
  IDENTIFIER_LIFECYCLE_STATES,
  type IdentifierFact,
  type IdentifierLifecycleState,
  identifierProviderSchema,
} from "@langwatch/identity-contract";

/**
 * The `Identifier` row shape a stored fact is read back from.
 *
 * Structural rather than the generated model type, because it is also the
 * contract a test writes rows against: every column the fold writes and the
 * heads read, and no other. A column added to the model that nothing here
 * names is a column this mapping does not carry, which is exactly what the
 * type should say.
 */
export interface IdentifierRow {
  id: string;
  userId: string;
  provider: string;
  value: string | null;
  domain: string | null;
  identifierHash: string | null;
  accountId: string | null;
  providerId: string | null;
  issuer: string | null;
  providerAccountId: string | null;
  state: string;
  connectionId: string | null;
  verifiedAt: Date | null;
  attachedAt: Date;
  detachedAt: Date | null;
}

/**
 * The stored lifecycle state, or a throw.
 *
 * A state this build does not know is not a state to treat as detached: the
 * row was written by a build that knew it, and guessing would answer a
 * question about somebody's live sign-in with a value nobody wrote. The read
 * fork above catches it and falls back to the legacy column, which is the one
 * safe reading of "this projection says something I cannot parse".
 */
export function parseIdentifierLifecycleState(raw: string): IdentifierLifecycleState {
  const state = IDENTIFIER_LIFECYCLE_STATES.find((candidate) => candidate === raw);
  if (!state) throw new Error(`Identifier row carries unknown state ${JSON.stringify(raw)}`);
  return state;
}

/**
 * One stored `Identifier` row as the fact the reducer and the reads speak.
 *
 * The projection writer and every reader have to agree on this mapping or the
 * guards would read a different shape than the fold wrote, which is why it is
 * one function rather than a projection each repository performs for itself.
 */
export function identifierRowToFact(row: IdentifierRow): IdentifierFact {
  return {
    identifierId: row.id,
    userId: row.userId,
    provider: identifierProviderSchema.parse(row.provider),
    value: row.value,
    domain: row.domain,
    identifierHash: row.identifierHash,
    accountId: row.accountId,
    providerId: row.providerId,
    issuer: row.issuer,
    providerAccountId: row.providerAccountId,
    connectionId: row.connectionId,
    state: parseIdentifierLifecycleState(row.state),
    verifiedAtMs: row.verifiedAt?.getTime() ?? null,
    attachedAtMs: row.attachedAt.getTime(),
    detachedAtMs: row.detachedAt?.getTime() ?? null,
  };
}
