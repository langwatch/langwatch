import type { IdentityUsersRepository } from "@langwatch/identity-server";

/**
 * The `User` reads the identity guards take, in memory.
 *
 * Shared rather than re-declared per suite because the guards need it
 * everywhere they are constructed — the pipeline's staged re-run included —
 * and a suite that quietly stubbed `findUserIdByEmail` to something looser
 * than the real repository would be proving the guard against a population
 * that cannot collide (ADR-116 §6).
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
    async findEmail({ userId }) {
      return rows.get(userId) ?? null;
    },
    async findUserIdByEmail({ normalizedValue }) {
      for (const [userId, email] of rows) {
        if (email.toLowerCase() === normalizedValue.toLowerCase()) {
          return userId;
        }
      }
      return null;
    },
  };
}
