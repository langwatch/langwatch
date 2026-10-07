import type { SessionImpersonation } from "@langwatch/auth-contract";
import { fromDate, Temporal, toDate, type Instant } from "@langwatch/time";

import type {
  AuthSessionRepository,
  BrowserSessionRecord,
  SessionExpiry,
  StoredBrowserSession,
} from "../auth-session.repository.ts";
import type { MemoryAuthDatabase, MemorySessionRow } from "./memory.auth.database.ts";

const EPOCH: Instant = Temporal.Instant.fromEpochMilliseconds(0);

function instantOf(date: MemorySessionRow["createdAt"]): Instant {
  return date === undefined ? EPOCH : fromDate(date);
}

function storedOf(row: MemorySessionRow): StoredBrowserSession {
  return {
    id: row.id,
    userId: row.userId,
    sessionToken: row.sessionToken,
    impersonation:
      row.actorUserId || row.subjectUserId || row.impersonationExpiresAt
        ? {
            actorUserId: row.actorUserId ?? null,
            subjectUserId: row.subjectUserId ?? null,
            reason: row.impersonationReason ?? null,
            expiresAt: row.impersonationExpiresAt ? fromDate(row.impersonationExpiresAt) : null,
          }
        : null,
    createdAt: instantOf(row.createdAt),
    lastSeenAt: row.lastSeenAt === undefined ? null : fromDate(row.lastSeenAt),
    updatedAt: instantOf(row.updatedAt),
  };
}

/**
 * The `Session` rows of the shared memory-adapter database, with the Prisma
 * twin's delete semantics. Every method reads `db.Session` afresh, because a
 * committed transaction or a delete replaces the array.
 */
export class MemoryAuthSessionRepository implements AuthSessionRepository {
  private constructor(private readonly memory: MemoryAuthDatabase) {}

  static create({ memory }: { memory: MemoryAuthDatabase }): MemoryAuthSessionRepository {
    return new MemoryAuthSessionRepository(memory);
  }

  async countSignedInUsers({ at }: { at: number }): Promise<number> {
    const signedIn = this.memory.db.Session.filter(
      (session) => session.expires !== undefined && session.expires.getTime() >= at,
    );
    return new Set(signedIn.map((session) => session.userId)).size;
  }

  async countSignedInUsersAmong({
    userIds,
    at,
  }: {
    userIds: readonly string[];
    at: number;
  }): Promise<number> {
    const among = new Set(userIds);
    const signedIn = this.memory.db.Session.filter(
      (session) =>
        among.has(session.userId) &&
        session.expires !== undefined &&
        session.expires.getTime() >= at,
    );
    return new Set(signedIn.map((session) => session.userId)).size;
  }

  async findById({ id }: { id: string }): Promise<StoredBrowserSession | null> {
    const session = this.memory.db.Session.find((row) => row.id === id);

    return session ? storedOf(session) : null;
  }

  async writeImpersonation({
    sessionId,
    claims,
  }: {
    sessionId: string;
    claims: SessionImpersonation;
  }): Promise<void> {
    this.replace({
      sessionId,
      change: {
        actorUserId: claims.actorUserId,
        subjectUserId: claims.subjectUserId,
        impersonationReason: claims.reason,
        impersonationExpiresAt: toDate(claims.expiresAt),
      },
    });
  }

  async clearImpersonation({ sessionId }: { sessionId: string }): Promise<void> {
    this.replace({
      sessionId,
      change: {
        actorUserId: null,
        subjectUserId: null,
        impersonationReason: null,
        impersonationExpiresAt: null,
      },
    });
  }

  async touch({ sessionId, at }: { sessionId: string; at: Instant }): Promise<void> {
    this.replace({ sessionId, change: { lastSeenAt: toDate(at) } });
  }

  async findStoredForUser({
    userId,
  }: {
    userId: string;
  }): Promise<readonly StoredBrowserSession[]> {
    return this.memory.db.Session.filter((session) => session.userId === userId).map(storedOf);
  }

  async findForUser({ userId }: { userId: string }): Promise<readonly BrowserSessionRecord[]> {
    return this.memory.db.Session.filter((session) => session.userId === userId)
      .map((session) => ({
        id: session.id,
        identifierId: session.identifierId ?? null,
        amr: [...(session.amr ?? [])],
        ipAddress: session.ipAddress ?? null,
        userAgent: session.userAgent ?? null,
        createdAt: instantOf(session.createdAt),
        updatedAt: instantOf(session.updatedAt),
        expires: instantOf(session.expires),
      }))
      .toSorted((left, right) => Temporal.Instant.compare(right.createdAt, left.createdAt));
  }

  async findTokensForUser({ userId }: { userId: string }): Promise<string[]> {
    return this.memory.db.Session.filter((session) => session.userId === userId).map(
      (session) => session.sessionToken,
    );
  }

  async deleteAllForUser({ userId }: { userId: string }): Promise<number> {
    return this.remove((session) => session.userId === userId);
  }

  async deleteById({ id }: { id: string }): Promise<number> {
    return this.remove((session) => session.id === id);
  }

  async deleteOthersForUser({
    userId,
    keepSessionId,
  }: {
    userId: string;
    keepSessionId: string;
  }): Promise<number> {
    return this.remove((session) => session.userId === userId && session.id !== keepSessionId);
  }

  async findExpiryByToken({ token }: { token: string }): Promise<SessionExpiry[]> {
    return this.memory.db.Session.filter((session) => session.sessionToken === token).map(
      (session) => ({ expires: instantOf(session.expires), userId: session.userId }),
    );
  }

  async findAmrForSession({ sessionId }: { sessionId: string }): Promise<string[]> {
    return [...(this.memory.db.Session.find((row) => row.id === sessionId)?.amr ?? [])];
  }

  async findAmrForIdentifiers({
    userIds,
    identifierIds,
    at,
  }: {
    userIds: readonly string[];
    identifierIds: readonly string[];
    at: Instant;
  }): Promise<string[]> {
    const asserted = this.memory.db.Session.filter(
      (session) =>
        userIds.includes(session.userId) &&
        session.identifierId !== undefined &&
        session.identifierId !== null &&
        identifierIds.includes(session.identifierId) &&
        session.expires !== undefined &&
        session.expires.getTime() > at.epochMilliseconds,
    );

    return [...new Set(asserted.flatMap((session) => session.amr ?? []))];
  }

  /** Copy-on-write, so a row a caller already read never changes under it. */
  private replace({
    sessionId,
    change,
  }: {
    sessionId: string;
    change: Partial<MemorySessionRow>;
  }): void {
    this.memory.db.Session = this.memory.db.Session.map((row) =>
      row.id === sessionId ? { ...row, ...change } : row,
    );
  }

  /** Deleting an absent row counts zero rather than raising, as `deleteMany` does. */
  private remove(matches: (session: MemorySessionRow) => boolean): number {
    const before = this.memory.db.Session;
    const kept = before.filter((session) => !matches(session));

    this.memory.db.Session = kept;

    return before.length - kept.length;
  }
}
