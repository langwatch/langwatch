export type StoredBrowserSession = {
  id: string;
  userId: string;
  sessionToken: string;
  impersonating: unknown;
};

/** Private persistence boundary for Better Auth session lifecycle facts. */
export abstract class AuthSessionRepository {
  abstract tryFindById(input: { id: string }): Promise<StoredBrowserSession | null>;
  abstract isUserActive(input: { id: string }): Promise<boolean>;
  abstract listTokensForUser(input: { userId: string }): Promise<string[]>;
  abstract deleteAllForUser(input: { userId: string }): Promise<number>;
  abstract deleteById(input: { id: string }): Promise<number>;
  abstract deleteOthersForUser(input: { userId: string; keepSessionId: string }): Promise<number>;
}
