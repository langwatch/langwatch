/**
 * Better Auth's optional shared session cache. Accelerator not truth; needed
 * so revocations hit all tiers, not just the database.
 */
export interface AuthSessionCacheRepository {
  /** The value cached at one key; empty on a miss, which is the ordinary answer. */
  findValues(input: { key: string }): Promise<string[]>;
  /** Every write expires: the TTL is part of the write, never a second command. */
  set(input: { key: string; value: string; ttlSeconds: number }): Promise<void>;
  delete(input: { key: string }): Promise<void>;
}
