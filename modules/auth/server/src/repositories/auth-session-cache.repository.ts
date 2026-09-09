/**
 * Better Auth's optional shared session cache and active-session index.
 *
 * It is an accelerator, never the truth: the database holds the session, and a
 * deployment that composed no cache reads and writes nothing here. What it does
 * hold is the copy a second process serves from, so a revocation that skipped
 * it would leave the other tier answering "signed in" for the full session
 * lifetime.
 */
export interface AuthSessionCacheRepository {
  /** The cached value at one key, or nothing. A miss is the ordinary answer. */
  findValue(input: { key: string }): Promise<string | null>;
  set(input: { key: string; value: string }): Promise<void>;
  delete(input: { key: string }): Promise<void>;
}
