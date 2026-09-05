/**
 * The Postgres projection of presence (ADR-128, "Presence").
 */

import { LAST_SEEN_WRITE_INTERVAL_MS } from "@langwatch/agent-contract";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:connected-agents:presence");

/**
 * The one write this projection needs, not the whole repository — narrow so
 * a composition root outside the package can satisfy it without the private
 * `AgentRepository` type.
 */
export interface AgentLastSeenWriter {
  touchLastSeenAt(input: { id: string; projectId: string; at: Date }): Promise<void>;
}

/** When each agent's row was last written by this process. */
const lastWrites = new Map<string, number>();

export class ConnectedAgentPresenceProjection {
  static create(): ConnectedAgentPresenceProjection {
    return new ConnectedAgentPresenceProjection();
  }

  /**
   * Writes `lastSeenAt` unless this process wrote it inside the last minute.
   */
  static async touchAgentLastSeen({
    repository,
    projectId,
    agentId,
    now = Date.now(),
    intervalMs = LAST_SEEN_WRITE_INTERVAL_MS,
  }: {
    repository: AgentLastSeenWriter;
    projectId: string;
    agentId: string;
    now?: number;
    intervalMs?: number;
  }): Promise<boolean> {
    const key = `${projectId}:${agentId}`;
    const last = lastWrites.get(key);
    if (last !== undefined && now - last < intervalMs) return false;
    lastWrites.set(key, now);
    try {
      await repository.touchLastSeenAt({
        id: agentId,
        projectId,
        at: new Date(now),
      });
      return true;
    } catch (error) {
      lastWrites.delete(key);
      logger.warn({ error, projectId, agentId }, "lastSeenAt write failed");
      return false;
    }
  }

  /** Forgets every throttle mark, for tests that reuse the process. */
  static resetLastSeenThrottle(): void {
    lastWrites.clear();
  }

  private constructor() {}
}
