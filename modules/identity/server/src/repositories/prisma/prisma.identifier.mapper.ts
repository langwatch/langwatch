import {
  IDENTIFIER_LIFECYCLE_STATES,
  type IdentifierFact,
  type IdentifierLifecycleState,
  identifierProviderSchema,
} from "@langwatch/identity-contract";

/**
 * The `Identifier` row shape a stored fact is read back from. Structural
 * rather than the generated model type, since it is also the contract a
 * test writes rows against: every column the fold writes and the heads read, and no other.
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
 * The stored lifecycle state, or a throw. A state this build does not know
 * is not a state to treat as detached — guessing would answer a question
 * about somebody's live sign-in with a value nobody wrote.
 */
export function parseIdentifierLifecycleState(raw: string): IdentifierLifecycleState {
  const state = IDENTIFIER_LIFECYCLE_STATES.find((candidate) => candidate === raw);
  if (!state) throw new Error(`Identifier row carries unknown state ${JSON.stringify(raw)}`);
  return state;
}

/**
 * One stored `Identifier` row as the fact the reducer and the reads speak.
 * Writer and every reader must agree on this mapping, or a guard would read
 * a different shape than the fold wrote — one function, not one per repository.
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

/**
 * One fact as the `Identifier` row that stores it — the exact inverse of
 * `identifierRowToFact`. A column carried one way and dropped the other is
 * a fact the projection silently forgets.
 */
export function identifierFactToRow(fact: IdentifierFact): IdentifierRow {
  return {
    id: fact.identifierId,
    userId: fact.userId,
    provider: fact.provider,
    value: fact.value,
    domain: fact.domain,
    identifierHash: fact.identifierHash,
    accountId: fact.accountId,
    providerId: fact.providerId,
    issuer: fact.issuer,
    providerAccountId: fact.providerAccountId,
    state: fact.state,
    connectionId: fact.connectionId,
    verifiedAt: fact.verifiedAtMs === null ? null : new Date(fact.verifiedAtMs),
    attachedAt: new Date(fact.attachedAtMs),
    detachedAt: fact.detachedAtMs === null ? null : new Date(fact.detachedAtMs),
  };
}
