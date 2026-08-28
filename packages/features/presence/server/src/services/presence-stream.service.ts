import { on } from "node:events";
import {
  presenceCursorEventSchema,
  presenceEventSchema,
  type PresenceCursorEvent,
  type PresenceCursorPayload,
  type PresenceEvent,
  type PresenceService as PresenceServiceContract,
} from "@langwatch/presence-contract";
import { createLogger } from "@langwatch/observability";
import type { PresenceEmitterPort } from "../ports/presence.port";

const logger = createLogger("langwatch:api:presence");

/** The frame shape the broadcast fabric hands a tenant emitter's listeners. */
type BroadcastFrame = { event: string; timestamp: number };

/**
 * Turns a tenant's raw broadcast frames into the presence events a subscriber
 * is allowed to see.
 *
 * Everything a subscriber must never receive is decided here rather than at
 * the transport: a frame that is not JSON, a frame that is not a presence
 * event, a frame belonging to another project, a cursor for an anchor the
 * subscriber is not watching, and a subscriber's own cursor echoed back.
 */
export class PresenceStreamService {
  private constructor(
    private readonly presence: PresenceServiceContract,
    private readonly emitters: PresenceEmitterPort,
  ) {}

  static create(options: {
    presence: PresenceServiceContract;
    emitters: PresenceEmitterPort;
  }): PresenceStreamService {
    return new PresenceStreamService(options.presence, options.emitters);
  }

  /**
   * One snapshot on connect, then `join` / `update` / `leave` deltas until the
   * subscriber disconnects. A project with presence switched off gets an empty
   * snapshot and no further frames, so the client can unsubscribe on its own.
   */
  async *events({
    projectId,
    signal,
  }: {
    projectId: string;
    signal?: AbortSignal;
  }): AsyncGenerator<PresenceEvent> {
    if (!(await this.presence.isEnabledForProject({ projectId }))) {
      yield { kind: "snapshot", sessions: [] };
      return;
    }

    const emitter = this.emitters.getTenantEmitter(projectId);

    logger.debug({ projectId }, "Presence subscription started");

    const snapshot = await this.presence.list({ projectId });
    yield { kind: "snapshot", sessions: snapshot };

    try {
      for await (const frame of on(emitter, "presence_updated", { signal })) {
        const decoded = decodeFrame(frame);
        if (decoded === undefined) {
          logger.warn({ projectId }, "Ignoring malformed presence broadcast payload");
          continue;
        }

        const result = presenceEventSchema.safeParse(decoded);
        if (!result.success) {
          logger.warn({ projectId }, "Ignoring invalid presence broadcast payload");
          continue;
        }

        const parsed = result.data;
        // Defense-in-depth: the per-tenant emitter should already isolate
        // events, but if a future refactor ever leaks a payload across
        // tenants, this drops it before it reaches the wire instead of
        // shipping another project's session metadata to a subscriber.
        if (
          (parsed.kind === "join" || parsed.kind === "update") &&
          parsed.session.projectId !== projectId
        ) {
          logger.error(
            { subscriberProjectId: projectId, eventProjectId: parsed.session.projectId },
            "Refusing to relay cross-tenant presence event",
          );
          continue;
        }

        yield parsed;
      }
    } finally {
      logger.debug({ projectId }, "Presence subscription cleanup");
      this.emitters.cleanupTenantEmitter(projectId);
    }
  }

  /**
   * Cursor ticks for a single anchor. Cross-anchor cursors and the
   * subscriber's own cursor are dropped here so the wire is never spent on
   * cursors the client cannot render.
   */
  async *cursors({
    projectId,
    anchor,
    sessionId,
    signal,
  }: {
    projectId: string;
    anchor: PresenceCursorPayload["anchor"];
    sessionId: string;
    signal?: AbortSignal;
  }): AsyncGenerator<PresenceCursorEvent> {
    if (!(await this.presence.isEnabledForProject({ projectId }))) return;

    const emitter = this.emitters.getTenantEmitter(projectId);

    try {
      for await (const frame of on(emitter, "presence_cursor", { signal })) {
        const decoded = decodeFrame(frame);
        if (decoded === undefined) continue;

        const result = presenceCursorEventSchema.safeParse(decoded);
        if (!result.success) continue;

        const parsed = result.data;
        // Defense-in-depth: per-tenant emitter already isolates this, but
        // a malformed payload or future shared-emitter regression must not
        // leak cursors across projects.
        if (parsed.projectId !== projectId) continue;
        if (parsed.anchor !== anchor) continue;
        // Don't echo a client's own cursor back to it.
        if (parsed.sessionId === sessionId) continue;

        yield parsed;
      }
    } finally {
      this.emitters.cleanupTenantEmitter(projectId);
    }
  }
}

/** The decoded frame payload, or `undefined` when it is not JSON at all. */
function decodeFrame(frame: unknown[]): unknown {
  const payload = frame[0] as BroadcastFrame;
  try {
    return JSON.parse(payload.event) as unknown;
  } catch {
    return undefined;
  }
}
