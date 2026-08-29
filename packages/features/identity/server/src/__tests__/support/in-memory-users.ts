import { normalizeIdentifierValue } from "@langwatch/identity-contract";
import type { IdentityUsersRepository } from "../../identity-users.repository";

/**
 * The `User` table as identity reads it, in memory: `email` per user and the
 * `userHashKey` write, nothing else.
 *
 * It exists mainly for the reverse read — `findUserIdByEmail`, the legacy
 * half of the cross-population collision guard (ADR-116 §6). A suite that
 * seeds no rows gets a population with no legacy holders, which is what
 * every guard test that is not ABOUT collisions wants; a suite that seeds
 * one gets the refusal.
 */
export class InMemoryUsers implements IdentityUsersRepository {
  /** userId → the address as `User.email` stores it, unnormalized. */
  readonly emails = new Map<string, string>();
  readonly hashKeys = new Map<string, string>();

  async storeUserHashKeyIfMissing({
    userId,
    userHashKey,
  }: {
    userId: string;
    userHashKey: string;
  }): Promise<void> {
    if (!this.hashKeys.has(userId)) this.hashKeys.set(userId, userHashKey);
  }

  async findEmail({ userId }: { userId: string }): Promise<string | null> {
    return this.emails.get(userId) ?? null;
  }

  /** The production comparison: case-insensitive equality against the column
   *  as stored, never a re-normalization of it. */
  async findUserIdByEmail({
    normalizedValue,
  }: {
    normalizedValue: string;
  }): Promise<string | null> {
    for (const [userId, email] of this.emails) {
      if (email.toLowerCase() === normalizedValue.toLowerCase()) return userId;
    }
    return null;
  }

  /** Seed a legacy user sitting on an address, the way `User.email` does. */
  holding({ userId, email }: { userId: string; email: string }): this {
    this.emails.set(userId, email);
    return this;
  }
}

/** A population with nobody in it: the default for a guard test that is not
 *  about collisions. Named so a reader can see the guard was wired, not
 *  skipped. */
export const noLegacyEmailHolders = (): InMemoryUsers => new InMemoryUsers();

/** The normalizer the guard applies before it asks, exposed so a suite can
 *  seed the address a value actually collides on. */
export const asStoredEmail = (value: string): string =>
  normalizeIdentifierValue(value);
