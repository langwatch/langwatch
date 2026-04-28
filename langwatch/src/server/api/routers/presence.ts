import { on } from "node:events";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getApp } from "~/server/app-layer/app";
import {
  presenceCursorAnchorSchema,
  presenceCursorPayloadSchema,
  presenceLocationSchema,
} from "~/server/app-layer/presence/types";
import type {
  PresenceCursorEvent,
  PresenceEvent,
} from "~/server/app-layer/presence/types";
import { createLogger } from "~/utils/logger/server";
import { checkProjectPermission } from "../rbac";

const logger = createLogger("langwatch:api:presence");

const projectInput = z.object({ projectId: z.string() });
const sessionInput = projectInput.extend({ sessionId: z.string().min(1) });

export const presenceRouter = createTRPCRouter({
  /**
   * Heartbeat + location update for a single browser session.
   *
   * The userId is taken from the authenticated session — clients cannot
   * impersonate another user by setting it in the payload.
   */
  update: protectedProcedure
    .input(
      sessionInput.extend({
        location: presenceLocationSchema,
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .mutation(async ({ input, ctx }) => {
      const user = ctx.session.user;
      await getApp().presence.update({
        projectId: input.projectId,
        sessionId: input.sessionId,
        user: {
          id: user.id,
          name: user.name ?? null,
          email: user.email ?? null,
          image: user.image ?? null,
        },
        location: input.location,
      });
      return { ok: true as const };
    }),

  /** Remove a session immediately and notify peers. */
  leave: protectedProcedure
    .input(sessionInput)
    .use(checkProjectPermission("traces:view"))
    .mutation(async ({ input }) => {
      await getApp().presence.leave({
        projectId: input.projectId,
        sessionId: input.sessionId,
      });
      return { ok: true as const };
    }),

  /**
   * Subscribe to presence updates for a project. Yields one snapshot event
   * on connect, then deltas (`join`, `update`, `leave`) until the client
   * disconnects.
   */
  onPresenceUpdate: protectedProcedure
    .input(projectInput)
    .use(checkProjectPermission("traces:view"))
    .subscription(async function* (opts) {
      const { projectId } = opts.input;
      const app = getApp();
      const emitter = app.broadcast.getTenantEmitter(projectId);

      logger.debug({ projectId }, "Presence subscription started");

      const snapshot = await app.presence.getByProject(projectId);
      yield { kind: "snapshot", sessions: snapshot } satisfies PresenceEvent;

      try {
        for await (const eventArgs of on(emitter, "presence_updated", {
          // @ts-expect-error - signal is not typed
          signal: opts.signal,
        })) {
          const payload = eventArgs[0] as { event: string; timestamp: number };
          let parsed: PresenceEvent;
          try {
            parsed = JSON.parse(payload.event) as PresenceEvent;
          } catch {
            logger.warn(
              { projectId },
              "Ignoring malformed presence broadcast payload",
            );
            continue;
          }
          yield parsed;
        }
      } finally {
        logger.debug({ projectId }, "Presence subscription cleanup");
        app.broadcast.cleanupTenantEmitter(projectId);
      }
    }),

  /**
   * High-frequency cursor tick. Fire-and-forget — server drops the event
   * silently if the per-tenant rate-limit bucket is exhausted.
   */
  cursor: protectedProcedure
    .input(
      sessionInput.extend({
        payload: presenceCursorPayloadSchema,
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .mutation(async ({ input, ctx }) => {
      const user = ctx.session.user;
      await getApp().presence.broadcastCursor({
        projectId: input.projectId,
        sessionId: input.sessionId,
        user: {
          id: user.id,
          name: user.name ?? null,
          email: user.email ?? null,
          image: user.image ?? null,
        },
        payload: input.payload,
      });
      return { ok: true as const };
    }),

  /**
   * Subscribe to cursor ticks for a single anchor. Only events whose anchor
   * matches are yielded to the client; cross-anchor cursors are filtered
   * out at the server boundary so the wire is never wasted on cursors the
   * client cannot render.
   */
  onPresenceCursor: protectedProcedure
    .input(
      projectInput.extend({
        anchor: presenceCursorAnchorSchema,
        sessionId: z.string().min(1),
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .subscription(async function* (opts) {
      const { projectId, anchor, sessionId } = opts.input;
      const emitter = getApp().broadcast.getTenantEmitter(projectId);

      try {
        for await (const eventArgs of on(emitter, "presence_cursor", {
          // @ts-expect-error - signal is not typed
          signal: opts.signal,
        })) {
          const payload = eventArgs[0] as { event: string; timestamp: number };
          let parsed: PresenceCursorEvent;
          try {
            parsed = JSON.parse(payload.event) as PresenceCursorEvent;
          } catch {
            continue;
          }
          if (parsed.anchor !== anchor) continue;
          // Don't echo a client's own cursor back to it.
          if (parsed.sessionId === sessionId) continue;
          yield parsed;
        }
      } finally {
        getApp().broadcast.cleanupTenantEmitter(projectId);
      }
    }),
});
