/**
 * The browser sessions this module owns, as rows.
 *
 * Every operation is keyed by a session id or a user id, which is the whole of
 * what session lifecycle needs: nothing here queries by anything else, and the
 * token column is read only so a revocation can evict the matching cache entry.
 */
export type StoredBrowserSession = {
  id: string;
  userId: string;
  sessionToken: string;
  impersonating: unknown;
};

/** Private persistence boundary for Better Auth session lifecycle facts. */
export interface AuthSessionRepository {
  findById(input: { id: string }): Promise<StoredBrowserSession | null>;
  listTokensForUser(input: { userId: string }): Promise<string[]>;
  deleteAllForUser(input: { userId: string }): Promise<number>;
  deleteById(input: { id: string }): Promise<number>;
  deleteOthersForUser(input: { userId: string; keepSessionId: string }): Promise<number>;
}
