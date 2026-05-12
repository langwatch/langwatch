import { createLogger } from "~/utils/logger/server";
import type { BroadcastService } from "../broadcast/broadcast.service";
import type { PresenceConfig } from "../projects/repositories/project.repository";
import type { PresenceRepository } from "./repositories/presence.repository";
import type {
  PresenceCursorEvent,
  PresenceCursorPayload,
  PresenceEvent,
  PresenceLocation,
  PresenceSession,
  PresenceUser,
} from "./types";

export const PRESENCE_TTL_SECONDS = 30;

/**
 * Subset of {@link ProjectService} that PresenceService depends on. Stated
 * structurally to avoid a service-to-service import cycle and to keep the
 * presence service trivial to fake in tests.
 */
export interface PresenceProjectLookup {
  getPresenceConfig(projectId: string): Promise<PresenceConfig | null>;
}

export interface PresenceUpdateInput {
  projectId: string;
  sessionId: string;
  user: PresenceUser;
  location: PresenceLocation;
}

export interface PresenceLeaveInput {
  projectId: string;
  sessionId: string;
}

/**
 * Coordinates the per-project presence state behind a single facade.
 *
 * Storage is Redis (TTL'd session keys). Fanout reuses the existing
 * BroadcastService channel — presence deltas are serialised as JSON and
 * relayed to subscribers via the project's tenant EventEmitter.
 */
export class PresenceService {
  private readonly logger = createLogger("langwatch:presence-service");

  constructor(
    private readonly repository: PresenceRepository,
    private readonly broadcast: BroadcastService,
    private readonly projects: PresenceProjectLookup,
    private readonly ttlSeconds: number = PRESENCE_TTL_SECONDS,
  ) {}

  /**
   * Whether multiplayer presence is allowed for the given project. Org-level
   * disable is the global kill-switch; project-level disable scopes the kill
   * to a single project. Missing rows count as disabled — there's nothing to
   * broadcast for a project we can't load.
   */
  async isEnabledForProject(projectId: string): Promise<boolean> {
    const config = await this.projects.getPresenceConfig(projectId);
    if (!config) return false;
    return config.orgEnabled && config.projectEnabled;
  }

  /**
   * Record a heartbeat / location update for a session. Emits a join delta
   * the first time we see a session, an update delta when the location
   * actually changes, and silently refreshes the TTL when nothing changed.
   */
  async update(input: PresenceUpdateInput): Promise<PresenceSession> {
    const existing = await this.findSession(input.projectId, input.sessionId);

    const session: PresenceSession = {
      sessionId: input.sessionId,
      projectId: input.projectId,
      user: input.user,
      location: input.location,
      updatedAt: Date.now(),
    };

    await this.repository.upsert(session, this.ttlSeconds);

    if (!existing) {
      await this.publish(input.projectId, { kind: "join", session });
    } else if (!locationsEqual(existing.location, input.location)) {
      await this.publish(input.projectId, { kind: "update", session });
    }

    return session;
  }

  /**
   * Remove a session immediately and notify peers. Idempotent — calling leave
   * on a missing session is a no-op.
   */
  async leave(input: PresenceLeaveInput): Promise<void> {
    const removed = await this.repository.remove(
      input.projectId,
      input.sessionId,
    );
    if (!removed) return;

    await this.publish(input.projectId, {
      kind: "leave",
      sessionId: input.sessionId,
    });
  }

  /** Snapshot of currently-active sessions in a project. */
  async getByProject(projectId: string): Promise<PresenceSession[]> {
    return this.repository.findByProjectId(projectId);
  }

  /**
   * Fan a single cursor tick out to peers in the same project. Cursors are
   * pure pub/sub — no persistence, dropped silently when the per-tenant
   * rate limit is exhausted. Subscribers filter further by anchor so that
   * peers on different views never see each other's coordinates.
   */
  async broadcastCursor(input: {
    projectId: string;
    sessionId: string;
    user: PresenceUser;
    payload: PresenceCursorPayload;
  }): Promise<void> {
    const event: PresenceCursorEvent = {
      projectId: input.projectId,
      sessionId: input.sessionId,
      user: input.user,
      anchor: input.payload.anchor,
      x: input.payload.x,
      y: input.payload.y,
      emittedAt: Date.now(),
    };
    try {
      await this.broadcast.broadcastToTenantRateLimited(
        input.projectId,
        JSON.stringify(event),
        "presence_cursor",
        "delta",
      );
    } catch (error) {
      this.logger.warn(
        { error, projectId: input.projectId },
        "Failed to broadcast cursor event",
      );
    }
  }

  private async findSession(
    projectId: string,
    sessionId: string,
  ): Promise<PresenceSession | undefined> {
    return this.repository.findById(projectId, sessionId);
  }

  private async publish(
    projectId: string,
    event: PresenceEvent,
  ): Promise<void> {
    try {
      await this.broadcast.broadcastToTenant(
        projectId,
        JSON.stringify(event),
        "presence_updated",
      );
    } catch (error) {
      // Broadcast failure must not break the write path — sessions still
      // appear in the next snapshot pulled from Redis.
      this.logger.warn(
        { error, projectId, kind: event.kind },
        "Failed to broadcast presence event",
      );
    }
  }
}

function locationsEqual(a: PresenceLocation, b: PresenceLocation): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
