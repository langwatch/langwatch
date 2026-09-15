import type { PresenceSession } from "@langwatch/presence-contract";

/** Private persistence capability owned by the Presence feature. */
export abstract class PresenceRepository {
  abstract upsert(session: PresenceSession, ttlSeconds: number): Promise<void>;
  abstract remove(input: { projectId: string; sessionId: string }): Promise<boolean>;
  abstract listByProject(projectId: string): Promise<PresenceSession[]>;
  /** A session that has expired or was never published is a normal absence. */
  abstract findSession(input: {
    projectId: string;
    sessionId: string;
  }): Promise<PresenceSession | undefined>;
}
