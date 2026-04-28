import type { PresenceSession } from "../types";
import type { PresenceRepository } from "./presence.repository";

interface StoredEntry {
  session: PresenceSession;
  expiresAt: number;
}

/**
 * In-memory presence repository used as the null-object fallback when Redis
 * is unavailable, and in tests. TTL is enforced lazily on read.
 */
export class InMemoryPresenceRepository implements PresenceRepository {
  private readonly entries = new Map<string, StoredEntry>();
  private readonly now: () => number;

  constructor(options?: { now?: () => number }) {
    this.now = options?.now ?? (() => Date.now());
  }

  async upsert(session: PresenceSession, ttlSeconds: number): Promise<void> {
    this.entries.set(this.key(session.projectId, session.sessionId), {
      session,
      expiresAt: this.now() + ttlSeconds * 1000,
    });
  }

  async remove(projectId: string, sessionId: string): Promise<boolean> {
    return this.entries.delete(this.key(projectId, sessionId));
  }

  async findByProjectId(projectId: string): Promise<PresenceSession[]> {
    const prefix = `${projectId}::`;
    const sessions: PresenceSession[] = [];
    const now = this.now();

    for (const [key, entry] of this.entries) {
      if (!key.startsWith(prefix)) continue;
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
        continue;
      }
      sessions.push(entry.session);
    }
    return sessions;
  }

  private key(projectId: string, sessionId: string): string {
    return `${projectId}::${sessionId}`;
  }
}
