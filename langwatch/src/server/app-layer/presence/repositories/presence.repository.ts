import type { PresenceSession } from "../types";

export interface PresenceRepository {
  /** Write or refresh a session, resetting its TTL. */
  upsert(session: PresenceSession, ttlSeconds: number): Promise<void>;

  /** Remove a single session. Returns true if anything was deleted. */
  remove(projectId: string, sessionId: string): Promise<boolean>;

  /** All currently-active sessions for a project. */
  findByProjectId(projectId: string): Promise<PresenceSession[]>;
}
