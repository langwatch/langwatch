import type {
  IdentifierReservationHolder,
  IdentityReservationRepository,
} from "./repositories/identity-reservations.repository.ts";
import type { IdentityUsersRepository } from "./repositories/identity-users.repository.ts";

/**
 * The `User` reads the identity guards take, in memory. Shared rather than
 * re-declared per suite, or a looser stub of `tryFindUserIdByEmail` would
 * prove the guard against a population that cannot collide (ADR-116 §6).
 */
export function inMemoryIdentityUsers({
  emails = {},
}: {
  /** userId → the address as `User.email` stores it. */
  emails?: Record<string, string>;
} = {}): IdentityUsersRepository {
  const rows = new Map(Object.entries(emails));
  return {
    async storeUserHashKeyIfMissing() {},
    async tryFindEmail({ userId }) {
      return rows.get(userId) ?? null;
    },
    async tryFindUserIdByEmail({ normalizedValue }) {
      for (const [userId, email] of rows) {
        if (email.toLowerCase() === normalizedValue.toLowerCase()) {
          return userId;
        }
      }
      return null;
    },
  };
}

/**
 * The address lock (ADR-116 §6), in memory. A `Map` insert is atomic, same
 * as the Postgres primary key: first writer wins. A suite that stubbed this
 * to always grant the claim would prove the guard against a lock that never locks.
 */
export function inMemoryIdentityReservations(): IdentityReservationRepository & {
  held: Map<string, IdentifierReservationHolder>;
} {
  const held = new Map<string, IdentifierReservationHolder>();
  return {
    held,
    async claim({ normalizedValue, userId, identifierId, commandId }) {
      const existing = held.get(normalizedValue);
      if (existing) return existing;
      const claim = { normalizedValue, userId, identifierId, commandId };
      held.set(normalizedValue, claim);
      return claim;
    },
    async release({ userId, holdingIdentifierIds }) {
      let released = 0;
      for (const [value, claim] of [...held]) {
        if (claim.userId !== userId) continue;
        if (holdingIdentifierIds.includes(claim.identifierId)) continue;
        held.delete(value);
        released += 1;
      }
      return released;
    },
    async reapOrphans() {
      return 0;
    },
  };
}
