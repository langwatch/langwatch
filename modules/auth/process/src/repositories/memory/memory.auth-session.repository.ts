import { Temporal, type Instant } from "@langwatch/time";

import type {
  AuthSessionRepository,
  BrowserSessionRecord,
  StoredBrowserSession,
} from "../auth-session.repository.ts";
import type { MemoryAuthDatabase, MemoryStoredSession } from "./memory.auth.database.ts";

const EPOCH: Instant = Temporal.Instant.fromEpochMilliseconds(0);

/** The `Session` rows in memory, with the Prisma twin's delete semantics. */
export class MemoryAuthSessionRepository implements AuthSessionRepository {
  private constructor(private readonly memory: MemoryAuthDatabase) {}

  static create({ memory }: { memory: MemoryAuthDatabase }): MemoryAuthSessionRepository {
    return new MemoryAuthSessionRepository(memory);
  }

  async countSignedInUsers({ at }: { at: number }): Promise<number> {
    const signedIn = [...this.memory.sessions.values()].filter(
      (session) => session.expires !== undefined && session.expires.epochMilliseconds >= at,
    );
    return new Set(signedIn.map((session) => session.userId)).size;
  }

  async findById({ id }: { id: string }): Promise<StoredBrowserSession | null> {
    const session = this.memory.sessions.get(id);
    if (!session) return null;

    return {
      id: session.id,
      userId: session.userId,
      sessionToken: session.sessionToken,
      impersonating: session.impersonating,
      createdAt: session.createdAt ?? EPOCH,
      lastSeenAt: session.lastSeenAt ?? null,
      updatedAt: session.updatedAt ?? EPOCH,
    };
  }

  async touch({ sessionId, at }: { sessionId: string; at: Instant }): Promise<void> {
    const session = this.memory.sessions.get(sessionId);
    if (!session) return;

    this.memory.sessions.set(sessionId, { ...session, lastSeenAt: at });
  }

  async findStoredForUser({
    userId,
  }: {
    userId: string;
  }): Promise<readonly StoredBrowserSession[]> {
    return [...this.memory.sessions.values()]
      .filter((session) => session.userId === userId)
      .map((session) => ({
        id: session.id,
        userId: session.userId,
        sessionToken: session.sessionToken,
        impersonating: session.impersonating,
        createdAt: session.createdAt ?? EPOCH,
        lastSeenAt: session.lastSeenAt ?? null,
        updatedAt: session.updatedAt ?? EPOCH,
      }));
  }

  async findForUser({ userId }: { userId: string }): Promise<readonly BrowserSessionRecord[]> {
    return [...this.memory.sessions.values()]
      .filter((session) => session.userId === userId)
      .map((session) => ({
        id: session.id,
        identifierId: session.identifierId ?? null,
        amr: session.amr ?? [],
        ipAddress: session.ipAddress ?? null,
        userAgent: session.userAgent ?? null,
        createdAt: session.createdAt ?? EPOCH,
        updatedAt: session.updatedAt ?? EPOCH,
        expires: session.expires ?? EPOCH,
      }))
      .toSorted((left, right) => Temporal.Instant.compare(right.createdAt, left.createdAt));
  }

  async findTokensForUser({ userId }: { userId: string }): Promise<string[]> {
    return [...this.memory.sessions.values()]
      .filter((session) => session.userId === userId)
      .map((session) => session.sessionToken);
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

  /** Deleting an absent row counts zero rather than raising, as `deleteMany` does. */
  private remove(matches: (session: MemoryStoredSession) => boolean): number {
    const doomed = [...this.memory.sessions.values()].filter(matches);

    for (const session of doomed) this.memory.sessions.delete(session.id);

    return doomed.length;
  }
}
