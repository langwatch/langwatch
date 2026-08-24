import {
  IDENTIFIER_LIFECYCLE_STATES,
  type IdentifierFact,
  type IdentifierLifecycleState,
  identifierProviderSchema,
} from "@langwatch/identity";

/**
 * The `Identifier` row ⇄ `IdentifierFact` mapping every identity repository
 * shares: the heads reader and the projection writer must agree on it or
 * the guards would read a different shape than the fold wrote.
 */
export interface IdentifierRowShape {
  id: string;
  userId: string;
  provider: string;
  value: string | null;
  domain: string | null;
  identifierHash: string | null;
  accountId: string | null;
  providerId: string | null;
  providerAccountId: string | null;
  state: string;
  connectionId: string | null;
  verifiedAt: Date | null;
  attachedAt: Date;
  detachedAt: Date | null;
}

export function parseLifecycleState(raw: string): IdentifierLifecycleState {
  const state = IDENTIFIER_LIFECYCLE_STATES.find(
    (candidate) => candidate === raw,
  );
  if (!state) {
    throw new Error(`Identifier row carries unknown state "${raw}"`);
  }
  return state;
}

export function rowToFact(row: IdentifierRowShape): IdentifierFact {
  return {
    identifierId: row.id,
    userId: row.userId,
    provider: identifierProviderSchema.parse(row.provider),
    value: row.value,
    domain: row.domain,
    identifierHash: row.identifierHash,
    accountId: row.accountId,
    providerId: row.providerId,
    providerAccountId: row.providerAccountId,
    connectionId: row.connectionId,
    state: parseLifecycleState(row.state),
    verifiedAtMs: row.verifiedAt?.getTime() ?? null,
    attachedAtMs: row.attachedAt.getTime(),
    detachedAtMs: row.detachedAt?.getTime() ?? null,
  };
}

export function factToRow(fact: IdentifierFact): IdentifierRowShape {
  return {
    id: fact.identifierId,
    userId: fact.userId,
    provider: fact.provider,
    value: fact.value,
    domain: fact.domain,
    identifierHash: fact.identifierHash,
    accountId: fact.accountId,
    providerId: fact.providerId,
    providerAccountId: fact.providerAccountId,
    state: fact.state,
    connectionId: fact.connectionId,
    verifiedAt: fact.verifiedAtMs === null ? null : new Date(fact.verifiedAtMs),
    attachedAt: new Date(fact.attachedAtMs),
    detachedAt: fact.detachedAtMs === null ? null : new Date(fact.detachedAtMs),
  };
}
