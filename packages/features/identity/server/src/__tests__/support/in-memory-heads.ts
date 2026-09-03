import {
  emptyIdentityHeads,
  type IdentifierFact,
  type IdentityFact,
  type IdentityFactInput,
  type IdentityHeads,
  reduceIdentity,
} from "@langwatch/identity-contract";
import type { IdentityHeadsRepository } from "../../identity-heads.repository";

export const USER = "user_sam";
export const ACTOR = { type: "user" as const, id: USER };
export const T0 = 1_690_000_000_000;

/**
 * The heads as an in-memory projection: the guard reads through the port,
 * and `fold` applies facts exactly as the app's fold projection would, so
 * a suite can state a history and read the heads it implies.
 */
export class InMemoryHeads implements IdentityHeadsRepository {
  hashKeys = new Map<string, string>();
  heads = new Map<string, IdentityHeads>();
  activeByValue = new Map<string, { userId: string; identifierId: string }>();

  async findUserHashKey({ userId }: { userId: string }) {
    return this.hashKeys.get(userId) ?? null;
  }

  async findHeads({ userId }: { userId: string }): Promise<IdentityHeads> {
    return this.heads.get(userId) ?? emptyIdentityHeads({ userId });
  }

  async findActiveIdentifierByValue({
    normalizedValue,
  }: {
    normalizedValue: string;
  }) {
    if (this.activeByValue.has(normalizedValue)) {
      return this.activeByValue.get(normalizedValue) ?? null;
    }
    for (const heads of this.heads.values()) {
      for (const head of Object.values(heads.identifiers)) {
        if (
          head.value === normalizedValue &&
          (head.state === "VERIFIED" || head.state === "PRIMARY")
        ) {
          return { userId: head.userId, identifierId: head.identifierId };
        }
      }
    }
    return null;
  }

  async findIdentifier({
    userId,
    identifierId,
  }: {
    userId: string;
    identifierId: string;
  }): Promise<IdentifierFact | null> {
    return this.heads.get(userId)?.identifiers[identifierId] ?? null;
  }

  async findIdentifierIdForAccount({
    userId,
    accountId,
    providerId,
  }: {
    userId: string;
    accountId: string;
    providerId: string;
  }): Promise<string | null> {
    const heads = Object.values(this.heads.get(userId)?.identifiers ?? {});
    const byAccount = heads.find((head) => head.accountId === accountId);
    if (byAccount) return byAccount.identifierId;
    const byProvider = heads.filter(
      (head) => head.providerId === providerId && head.detachedAtMs === null,
    );
    return byProvider.length === 1 ? (byProvider[0]?.identifierId ?? null) : null;
  }

  /** Fold facts into a user's heads, the way the app's projection would. */
  fold(userId: string, facts: IdentityFactInput[], occurredAt = T0): void {
    const heads = facts.reduce(
      (current, fact) =>
        reduceIdentity({
          heads: current,
          fact: { ...fact, occurredAt } as IdentityFact,
        }),
      this.heads.get(userId) ?? emptyIdentityHeads({ userId }),
    );
    this.heads.set(userId, heads);
  }
}

export function fact(overrides?: Partial<IdentifierFact>): IdentifierFact {
  return {
    identifierId: "idf_work",
    userId: USER,
    provider: "email",
    value: "sam@acme.com",
    domain: "acme.com",
    identifierHash: "hmac:abc",
    accountId: null,
    providerId: null,
    issuer: null,
    providerAccountId: null,
    connectionId: null,
    state: "VERIFIED",
    verifiedAtMs: T0,
    attachedAtMs: T0,
    detachedAtMs: null,
    ...overrides,
  };
}

export function headsWith(...facts: IdentifierFact[]): IdentityHeads {
  return {
    userId: USER,
    identifiers: Object.fromEntries(facts.map((f) => [f.identifierId, f])),
  };
}

export function attachData(overrides?: Record<string, unknown>) {
  return {
    tenantId: USER,
    userId: USER,
    commandId: "idcmd_1",
    accountId: "acc_1",
    provider: "google" as const,
    providerId: "google",
    // Google's REAL issuer, which is what better-auth keys a google account
    // by — not the `local:oauth:google` a derivation would produce. Using
    // the real one here is what keeps these fixtures honest about the fact
    // that an issuer is stated, never computed.
    issuer: "https://accounts.google.com",
    providerAccountId: "gid_123",
    // Mixed case AND a plus tag, because normalization treats them
    // differently and both halves are worth pinning: the case is folded, the
    // tag SURVIVES. `sam.j+x@acme.com` and `sam.j@acme.com` are two addresses,
    // and a normalizer that merged them would hand one person's sign-in to
    // whoever holds the untagged mailbox.
    value: "Sam.J+x@Acme.com",
    occurredAtMs: T0,
    ceremony: { flow: "oauth-callback" },
    actor: ACTOR,
    ...overrides,
  };
}
