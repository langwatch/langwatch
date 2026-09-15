/**
 * Better Auth's optional shared session cache. Accelerator not truth; needed
 * so revocations hit all tiers, not just the database.
 */
export interface AuthSessionCacheRepository {
  /** The cached value at one key, or nothing. A miss is the ordinary answer. */
  findValue(input: { key: string }): Promise<string | null>;
  set(input: { key: string; value: string }): Promise<void>;
  delete(input: { key: string }): Promise<void>;
}
