import type { Instant } from "@langwatch/time";

/**
 * The browser sessions this module owns, as rows. Every operation is keyed by
 * a session id or a user id — nothing here queries by anything else — and the
 * token column is read only so a revocation can evict the matching cache entry.
 */
export type StoredBrowserSession = {
  id: string;
  userId: string;
  sessionToken: string;
  impersonating: unknown;
};

/**
 * One session as its owner's devices list needs it. Carries the evidence a
 * sign-in recorded (`identifierId`, `amr`) and the activity columns, never
 * the token: the list is read, and nothing on it can be replayed.
 */
export type BrowserSessionRecord = {
  id: string;
  identifierId: string | null;
  amr: readonly string[];
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Instant;
  /** When the row was last written — activity to the nearest day. */
  updatedAt: Instant;
  expires: Instant;
};

/** Private persistence boundary for Better Auth session lifecycle facts. */
export interface AuthSessionRepository {
  findById(input: { id: string }): Promise<StoredBrowserSession | null>;
  /** This person's sessions, newest first. */
  findForUser(input: { userId: string }): Promise<readonly BrowserSessionRecord[]>;
  listTokensForUser(input: { userId: string }): Promise<string[]>;
  deleteAllForUser(input: { userId: string }): Promise<number>;
  deleteById(input: { id: string }): Promise<number>;
  deleteOthersForUser(input: { userId: string; keepSessionId: string }): Promise<number>;
}
