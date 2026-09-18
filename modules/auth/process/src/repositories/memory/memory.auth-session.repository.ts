import type {
  AuthSessionRepository,
  StoredBrowserSession,
} from "../auth-session.repository.ts";
import type { MemoryAuthDatabase } from "./memory.auth.database.ts";

/** The `Session` rows in memory, with the Prisma twin's delete semantics. */
export class MemoryAuthSessionRepository implements AuthSessionRepository {
  private constructor(private readonly memory: MemoryAuthDatabase) {}

  static create({ memory }: { memory: MemoryAuthDatabase }): MemoryAuthSessionRepository {
    return new MemoryAuthSessionRepository(memory);
  }

  /** Test seam: the rows a case starts from, written the way Better Auth would. */
  put(session: StoredBrowserSession): void {
    this.memory.sessions.set(session.id, session);
  }

  async findById({ id }: { id: string }): Promise<StoredBrowserSession | null> {
    return this.memory.sessions.get(id) ?? null;
  }

  async listTokensForUser({ userId }: { userId: string }): Promise<string[]> {
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
  private remove(matches: (session: StoredBrowserSession) => boolean): number {
    const doomed = [...this.memory.sessions.values()].filter(matches);

    for (const session of doomed) this.memory.sessions.delete(session.id);

    return doomed.length;
  }
}
