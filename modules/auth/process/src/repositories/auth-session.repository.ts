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
  /** When the sign-in that minted this session happened (GAC-10). */
  createdAt: Instant;
  /** Our own activity stamp, null on any session never under a window. */
  lastSeenAt: Instant | null;
  /** better-auth's own roll, once a day; the stand-in when `lastSeenAt` is null. */
  updatedAt: Instant;
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
  /** Every session this person holds, in the shape a window is judged on. */
  findStoredForUser(input: { userId: string }): Promise<readonly StoredBrowserSession[]>;
  findTokensForUser(input: { userId: string }): Promise<string[]>;
  deleteAllForUser(input: { userId: string }): Promise<number>;
  deleteById(input: { id: string }): Promise<number>;
  deleteOthersForUser(input: { userId: string; keepSessionId: string }): Promise<number>;
  /** Records that a session was used, for the idle window (GAC-10). */
  touch(input: { sessionId: string; at: Instant }): Promise<void>;
  /** Distinct people holding an unexpired session at `at` (epoch ms), install-wide. */
  countSignedInUsers(input: { at: number }): Promise<number>;
  /** The session a token names, expired or not; empty when no row holds it. */
  findExpiryByToken(input: { token: string }): Promise<SessionExpiry[]>;
  /** The amr the session recorded; empty when the session is gone. */
  findAmrForSession(input: { sessionId: string }): Promise<string[]>;
  /** The distinct amr of sessions these people minted through these identifiers, live at `at`. */
  findAmrForIdentifiers(input: {
    userIds: readonly string[];
    identifierIds: readonly string[];
    at: Instant;
  }): Promise<string[]>;
}

/** When a session stopped being usable, and whose it was. */
export type SessionExpiry = { expires: Instant; userId: string };
