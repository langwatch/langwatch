import type { PresenceSession } from "@langwatch/presence-contract";
import { PresenceRepository } from "../presence.repository";

interface StoredEntry {
  session: PresenceSession;
  expiresAt: number;
}

export class MemoryPresenceRepository extends PresenceRepository {
  private readonly entries = new Map<string, StoredEntry>();

  private constructor(private readonly now: () => number) {
    super();
  }

  static create(options: { now?: () => number } = {}): MemoryPresenceRepository {
    return new MemoryPresenceRepository(options.now ?? (() => Date.now()));
  }

  async upsert(session: PresenceSession, ttlSeconds: number): Promise<void> {
    this.entries.set(this.key(session.projectId, session.sessionId), {
      session,
      expiresAt: this.now() + ttlSeconds * 1_000,
    });
  }

  async remove(projectId: string, sessionId: string): Promise<boolean> {
    return this.entries.delete(this.key(projectId, sessionId));
  }

  async tryFindSession(
    projectId: string,
    sessionId: string,
  ): Promise<PresenceSession | null> {
    const key = this.key(projectId, sessionId);
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.session;
  }

  async listByProject(projectId: string): Promise<PresenceSession[]> {
    const prefix = `${projectId}::`;
    const now = this.now();
    const sessions: PresenceSession[] = [];
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
