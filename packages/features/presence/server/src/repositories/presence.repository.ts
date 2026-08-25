import type { PresenceSession } from "@langwatch/presence-contract";

/** Private persistence capability owned by the Presence feature. */
export abstract class PresenceRepository {
  abstract upsert(session: PresenceSession, ttlSeconds: number): Promise<void>;
  abstract remove(projectId: string, sessionId: string): Promise<boolean>;
  abstract listByProject(projectId: string): Promise<PresenceSession[]>;
  abstract tryFindSession(
    projectId: string,
    sessionId: string,
  ): Promise<PresenceSession | null>;
}
