import { emptyIdentityHeads, type IdentifierFact, type IdentityHeads } from "@langwatch/identity-contract";
import type { BackfillIdentifierRow } from "@langwatch/identity-contract";
import { Temporal } from "@langwatch/time";
import type { Instant } from "@langwatch/time";
import type {
  BackfillAccountRow,
  BackfillUserRow,
  IdentityBackfillRepository,
} from "../identity-backfill.repository.ts";
import type { IdentityHeadsRepository } from "../identity-heads.repository.ts";
import type { AbandonedNewborn, IdentityNewbornRepository } from "../identity-newborn.repository.ts";
import type {
  IdentifierReservationHolder,
  IdentityReservationRepository,
} from "../identity-reservations.repository.ts";
import type { IdentityUsersRepository } from "../identity-users.repository.ts";
import type {
  IdentityVerificationRecord,
  IdentityVerificationRepository,
} from "../identity-verification.repository.ts";
import { MemoryIdentityStore } from "./memory-identity.store.ts";

const ACTIVE_STATES = new Set(["VERIFIED", "PRIMARY"]);

/** The heads twin: reads over the identifiers and users the store holds. */
export class MemoryIdentityHeadsRepository implements IdentityHeadsRepository {
  static create(store: MemoryIdentityStore): MemoryIdentityHeadsRepository {
    return new MemoryIdentityHeadsRepository(store);
  }

  private constructor(private readonly store: MemoryIdentityStore) {}

  async tryFindUserHashKey(args: { userId: string }): Promise<string | null> {
    return this.store.findUserRow(args)?.userHashKey ?? null;
  }

  async findHeads(args: { userId: string }): Promise<IdentityHeads> {
    const heads = emptyIdentityHeads({ userId: args.userId });
    for (const fact of this.store.findIdentifiersForUser(args)) {
      heads.identifiers[fact.identifierId] = fact;
    }

    return heads;
  }

  async tryFindActiveIdentifierByValue(args: {
    normalizedValue: string;
  }): Promise<{ userId: string; identifierId: string } | null> {
    const match = [...this.store.identifiers.values()].find(
      (fact) => fact.value === args.normalizedValue && ACTIVE_STATES.has(fact.state),
    );

    return match ? { userId: match.userId, identifierId: match.identifierId } : null;
  }

  async tryFindIdentifier(args: {
    userId: string;
    identifierId: string;
  }): Promise<IdentifierFact | null> {
    const fact = this.store.identifiers.get(args.identifierId);

    return fact && fact.userId === args.userId ? fact : null;
  }

  async tryFindIdentifierIdForAccount(args: {
    userId: string;
    accountId: string;
    providerId: string;
  }): Promise<string | null> {
    const own = this.store.findIdentifiersForUser(args);
    const byAccount = own.find((fact) => fact.accountId === args.accountId);
    if (byAccount) return byAccount.identifierId;

    // The Prisma row's fallback: exactly one live identifier on the verbatim
    // provider id, never a guess between two.
    const onProvider = own.filter(
      (fact) => fact.providerId === args.providerId && ACTIVE_STATES.has(fact.state),
    );

    return onProvider.length === 1 ? (onProvider[0]?.identifierId ?? null) : null;
  }
}

/** The `User` twin: the hash-key mint and the two `User.email` reads. */
export class MemoryIdentityUsersRepository implements IdentityUsersRepository {
  static create(store: MemoryIdentityStore): MemoryIdentityUsersRepository {
    return new MemoryIdentityUsersRepository(store);
  }

  private constructor(private readonly store: MemoryIdentityStore) {}

  async storeUserHashKeyIfMissing(args: { userId: string; userHashKey: string }): Promise<void> {
    const row = this.store.findUserRow(args);
    if (!row || row.userHashKey !== null) return;
    row.userHashKey = args.userHashKey;
  }

  async tryFindEmail(args: { userId: string }): Promise<string | null> {
    return this.store.findUserRow(args)?.email ?? null;
  }

  async tryFindUserIdByEmail(args: { normalizedValue: string }): Promise<string | null> {
    const wanted = args.normalizedValue.toLowerCase();
    const row = [...this.store.users.values()].find(
      (candidate) => (candidate.email ?? "").toLowerCase() === wanted,
    );

    return row?.id ?? null;
  }
}

/** The newborn twin: the claim latch and the abandoned sweep. */
export class MemoryIdentityNewbornRepository implements IdentityNewbornRepository {
  static create(store: MemoryIdentityStore): MemoryIdentityNewbornRepository {
    return new MemoryIdentityNewbornRepository(store);
  }

  private constructor(private readonly store: MemoryIdentityStore) {}

  async claim(args: { userId: string }): Promise<void> {
    this.store.newbornClaims.set(args.userId, Temporal.Now.instant());
  }

  async tryFindUserAtPinnedId(args: { userId: string }): Promise<{ id: string } | null> {
    const row = this.store.findUserRow(args);

    return row ? { id: row.id } : null;
  }

  async commitNewborn(args: {
    userId: string;
    user: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    const row = this.store.findUserRow(args);
    if (row) row.payload = args.user;
    this.store.newbornClaims.delete(args.userId);

    return args.user;
  }

  async findAbandoned(args: { olderThan: Instant; limit: number }): Promise<AbandonedNewborn[]> {
    return [...this.store.newbornClaims.entries()]
      .filter(([, claimedAt]) => Temporal.Instant.compare(claimedAt, args.olderThan) <= 0)
      .slice(0, args.limit)
      .map(([userId, claimedAt]) => ({ userId, claimedAt }));
  }

  async releaseClaim(args: { userId: string }): Promise<void> {
    this.store.newbornClaims.delete(args.userId);
  }
}

/** The reservation twin: first claim on a normalized value wins. */
export class MemoryIdentityReservationRepository implements IdentityReservationRepository {
  static create(store: MemoryIdentityStore): MemoryIdentityReservationRepository {
    return new MemoryIdentityReservationRepository(store);
  }

  private constructor(private readonly store: MemoryIdentityStore) {}

  async claim(args: {
    normalizedValue: string;
    userId: string;
    identifierId: string;
    commandId: string;
  }): Promise<IdentifierReservationHolder> {
    const held = this.store.reservations.get(args.normalizedValue);
    if (held) return held;
    this.store.reservations.set(args.normalizedValue, args);

    return args;
  }

  async release(args: {
    userId: string;
    holdingIdentifierIds: readonly string[];
  }): Promise<number> {
    let released = 0;
    for (const [value, holder] of this.store.reservations.entries()) {
      const held = holder.userId === args.userId;
      if (!held || !args.holdingIdentifierIds.includes(holder.identifierId)) continue;
      this.store.reservations.delete(value);
      released += 1;
    }

    return released;
  }

  async reapOrphans(): Promise<number> {
    return 0;
  }
}

/** The verification twin: one live record per identifier, consumed once. */
export class MemoryIdentityVerificationRepository implements IdentityVerificationRepository {
  static create(store: MemoryIdentityStore): MemoryIdentityVerificationRepository {
    return new MemoryIdentityVerificationRepository(store);
  }

  private constructor(private readonly store: MemoryIdentityStore) {}

  async replaceForIdentifier(record: IdentityVerificationRecord): Promise<void> {
    this.store.verifications.set(record.identifierId, record);
  }

  async tryFindByIdentifierId(args: {
    identifierId: string;
  }): Promise<IdentityVerificationRecord | null> {
    return this.store.verifications.get(args.identifierId) ?? null;
  }

  async consume(args: { identifierId: string; verificationId: string }): Promise<boolean> {
    const record = this.store.verifications.get(args.identifierId);
    if (!record || record.verificationId !== args.verificationId) return false;
    this.store.verifications.delete(args.identifierId);

    return true;
  }
}

/** The backfill twin: the three reads the plan is built from. */
export class MemoryIdentityBackfillRepository implements IdentityBackfillRepository {
  static create(store: MemoryIdentityStore): MemoryIdentityBackfillRepository {
    return new MemoryIdentityBackfillRepository(store);
  }

  private constructor(private readonly store: MemoryIdentityStore) {}

  async tryFindUser(args: { userId: string }): Promise<BackfillUserRow | null> {
    const row = this.store.findUserRow(args);
    if (!row) return null;

    return {
      id: row.id,
      email: row.email,
      emailVerified: row.emailVerified,
      createdAtMs: row.createdAtMs,
      userHashKey: row.userHashKey,
    };
  }

  async findAccountRows(args: { userId: string }): Promise<BackfillAccountRow[]> {
    return this.store.accounts.get(args.userId) ?? [];
  }

  async findIdentifierRows(args: { userId: string }): Promise<BackfillIdentifierRow[]> {
    return this.store.backfillIdentifiers.get(args.userId) ?? [];
  }
}
