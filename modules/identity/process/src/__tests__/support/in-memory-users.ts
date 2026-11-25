import { normalizeIdentifierValue } from "@langwatch/identity-contract";

import type { IdentityUsersRepository } from "../../repositories/identity-users.repository.ts";

/**
 * The `User` table as identity reads it, in memory. Mainly for
 * `findUserIdsByEmail` (the legacy collision guard, ADR-116 §6): unseeded
 * has no legacy holders (most guard tests), seeded gets the refusal.
 */
export class InMemoryUsers implements IdentityUsersRepository {
  /** userId → the address as `User.email` stores it, unnormalized. */
  readonly emails = new Map<string, string>();
  readonly hashKeys = new Map<string, string>();
  /** Users `User.emailVerified` does not stand behind. */
  readonly unverified = new Set<string>();

  async storeUserHashKeyIfMissing({
    userId,
    userHashKey,
  }: {
    userId: string;
    userHashKey: string;
  }): Promise<void> {
    if (!this.hashKeys.has(userId)) this.hashKeys.set(userId, userHashKey);
  }

  async getUserEmail({ userId }: { userId: string }): Promise<{ email: string | null }> {
    return { email: this.emails.get(userId) ?? null };
  }

  /** The production comparison: case-insensitive equality against the column
   *  as stored, never a re-normalization of it. */
  async findUserIdsByEmail({ normalizedValue }: { normalizedValue: string }): Promise<string[]> {
    return [...this.emails]
      .filter(([, email]) => email.toLowerCase() === normalizedValue.toLowerCase())
      .map(([userId]) => userId);
  }

  /** The three facts a cutover link is decided on, over the same rows. */
  async findAddressStanding({ userId }: { userId: string }): Promise<{
    email: string | null;
    emailVerified: boolean;
    holders: number;
  } | null> {
    const email = this.emails.get(userId);
    if (email === undefined) return null;
    const holders = [...this.emails.values()].filter(
      (candidate) => candidate.toLowerCase() === email.toLowerCase(),
    ).length;
    return { email, emailVerified: !this.unverified.has(userId), holders };
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
export const asStoredEmail = (value: string): string => normalizeIdentifierValue(value);
