import type { PresenceSession } from "../types";

export interface PresenceRepository {
  /** Write or refresh a session, resetting its TTL. */
  upsert(session: PresenceSession, ttlSeconds: number): Promise<void>;

  /** Remove a single session. Returns true if anything was deleted. */
  remove(projectId: string, sessionId: string): Promise<boolean>;

  /** All currently-active sessions for a project. */
  findByProjectId(projectId: string): Promise<PresenceSession[]>;

  /**
   * Single-session lookup. Implementations should make this O(1) (single
   * GET on Redis) since it's called on every heartbeat to detect location
   * changes; falling back to findByProjectId on the hot path is N².
   */
  findById(
    projectId: string,
    sessionId: string,
  ): Promise<PresenceSession | undefined>;
}
