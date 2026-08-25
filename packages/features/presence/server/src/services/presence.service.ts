import {
  PresenceService as PresenceServiceContract,
  presenceCursorInputSchema,
  presenceLeaveInputSchema,
  presenceProjectInputSchema,
  presenceUpdateInputSchema,
  type PresenceCursorInput,
  type PresenceEvent,
  type PresenceLeaveInput,
  type PresenceProjectInput,
  type PresenceSession,
  type PresenceUpdateInput,
} from "@langwatch/presence-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type {
  PresenceBroadcastPort,
  PresenceDiagnosticsPort,
} from "../ports/presence.port";
import type { PresenceRepository } from "../repositories/presence.repository";

export const PRESENCE_TTL_SECONDS = 30;

export class PresenceService extends PresenceServiceContract {
  private constructor(
    private readonly repository: PresenceRepository,
    private readonly broadcast: PresenceBroadcastPort,
    private readonly projects: ProjectService,
    private readonly diagnostics: PresenceDiagnosticsPort | undefined,
    private readonly ttlSeconds: number,
    private readonly now: () => number,
  ) {
    super();
  }

  static create(options: {
    repository: PresenceRepository;
    broadcast: PresenceBroadcastPort;
    projects: ProjectService;
    diagnostics?: PresenceDiagnosticsPort;
    ttlSeconds?: number;
    now?: () => number;
  }): PresenceService {
    const ttlSeconds = options.ttlSeconds ?? PRESENCE_TTL_SECONDS;
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) {
      throw new RangeError("ttlSeconds must be a positive safe integer");
    }
    return new PresenceService(
      options.repository,
      options.broadcast,
      options.projects,
      options.diagnostics,
      ttlSeconds,
      options.now ?? (() => Date.now()),
    );
  }

  isEnabledForProject(input: PresenceProjectInput): Promise<boolean> {
    const parsed = presenceProjectInputSchema.parse(input);
    return this.projects.isPresenceEnabled(parsed);
  }

  async update(input: PresenceUpdateInput): Promise<PresenceSession> {
    const parsed = presenceUpdateInputSchema.parse(input);
    const existing = await this.repository.tryFindSession(
      parsed.projectId,
      parsed.sessionId,
    );
    const session: PresenceSession = { ...parsed, updatedAt: this.now() };
    await this.repository.upsert(session, this.ttlSeconds);
    if (!existing) {
      await this.publishUpdate(parsed.projectId, { kind: "join", session });
    } else if (!locationsEqual(existing.location, parsed.location)) {
      await this.publishUpdate(parsed.projectId, { kind: "update", session });
    }
    return session;
  }

  async leave(input: PresenceLeaveInput): Promise<void> {
    const parsed = presenceLeaveInputSchema.parse(input);
    const removed = await this.repository.remove(
      parsed.projectId,
      parsed.sessionId,
    );
    if (!removed) return;
    await this.publishUpdate(parsed.projectId, {
      kind: "leave",
      sessionId: parsed.sessionId,
    });
  }

  list(input: PresenceProjectInput): Promise<PresenceSession[]> {
    const parsed = presenceProjectInputSchema.parse(input);
    return this.repository.listByProject(parsed.projectId);
  }

  async broadcastCursor(input: PresenceCursorInput): Promise<void> {
    const parsed = presenceCursorInputSchema.parse(input);
    await this.publish({
      projectId: parsed.projectId,
      event: JSON.stringify({
        projectId: parsed.projectId,
        sessionId: parsed.sessionId,
        user: parsed.user,
        ...parsed.payload,
        emittedAt: this.now(),
      }),
      channel: "presence_cursor",
      rateLimited: true,
    });
  }

  private publishUpdate(
    projectId: string,
    event: PresenceEvent,
  ): Promise<void> {
    return this.publish({
      projectId,
      event: JSON.stringify(event),
      channel: "presence_updated",
      rateLimited: false,
    });
  }

  private async publish(input: {
    projectId: string;
    event: string;
    channel: "presence_updated" | "presence_cursor";
    rateLimited: boolean;
  }): Promise<void> {
    try {
      await this.broadcast.publish(input);
    } catch (error) {
      this.diagnostics?.warn("Failed to broadcast presence event", {
        error,
        projectId: input.projectId,
        channel: input.channel,
      });
    }
  }
}

function locationsEqual(
  left: PresenceUpdateInput["location"],
  right: PresenceUpdateInput["location"],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
