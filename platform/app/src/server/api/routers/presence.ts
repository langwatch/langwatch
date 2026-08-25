import { on } from "node:events";
import { createLogger } from "@langwatch/observability";
import {
  presenceCursorAnchorSchema,
  presenceCursorEventSchema,
  presenceCursorInputSchema,
  presenceEventSchema,
  presenceLeaveInputSchema,
  presenceProjectInputSchema,
  presenceUpdateInputSchema,
  type PresenceEvent,
} from "@langwatch/presence-contract";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

const logger = createLogger("langwatch:api:presence");

const projectInput = presenceProjectInputSchema;
const sessionInput = presenceLeaveInputSchema;

export const presenceRouter = createTRPCRouter({
  /**
   * Heartbeat + location update for a single browser session.
   *
   * The userId is taken from the authenticated session — clients cannot
   * impersonate another user by setting it in the payload.
   */
  update: protectedProcedure
    .input(
      presenceUpdateInputSchema.omit({ user: true }),
    )
    .permission("traces:view")
    .mutation(async ({ input, ctx }) => {
      if (!(await ctx.app.presence.isEnabledForProject(input))) {
        return { ok: true as const };
      }
      const user = ctx.session.user;
      await ctx.app.presence.update({
        projectId: input.projectId,
        sessionId: input.sessionId,
        user: {
          id: user.id,
          name: user.name ?? null,
          image: user.image ?? null,
        },
        location: input.location,
      });
      return { ok: true as const };
    }),

  /** Remove a session immediately and notify peers. */
  leave: protectedProcedure
    .input(sessionInput)
    .permission("traces:view")
    .mutation(async ({ input, ctx }) => {
      if (!(await ctx.app.presence.isEnabledForProject(input))) {
        return { ok: true as const };
      }
      await ctx.app.presence.leave({
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
    .permission("traces:view")
    .subscription(async function* (opts) {
      const { projectId } = opts.input;
      const app = opts.ctx.app;

      // Yield an empty snapshot and exit immediately when presence is off —
      // the client unsubscribes on its own once it sees no further frames.
      if (!(await app.presence.isEnabledForProject({ projectId }))) {
        yield { kind: "snapshot", sessions: [] } satisfies PresenceEvent;
        return;
      }

      const emitter = app.broadcast.getTenantEmitter(projectId);

      logger.debug({ projectId }, "Presence subscription started");

      const snapshot = await app.presence.list({ projectId });
      yield { kind: "snapshot", sessions: snapshot } satisfies PresenceEvent;

      try {
        for await (const eventArgs of on(emitter, "presence_updated", {
          signal: opts.signal,
        })) {
          const payload = eventArgs[0] as { event: string; timestamp: number };
          let decoded: unknown;
          try {
            decoded = JSON.parse(payload.event);
          } catch {
            logger.warn(
              { projectId },
              "Ignoring malformed presence broadcast payload",
            );
            continue;
          }
          const result = presenceEventSchema.safeParse(decoded);
          if (!result.success) {
            logger.warn(
              { projectId },
              "Ignoring invalid presence broadcast payload",
            );
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
              {
                subscriberProjectId: projectId,
                eventProjectId: parsed.session.projectId,
              },
              "Refusing to relay cross-tenant presence event",
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
      presenceCursorInputSchema.omit({ user: true }),
    )
    .permission("traces:view")
    .mutation(async ({ input, ctx }) => {
      if (!(await ctx.app.presence.isEnabledForProject(input))) {
        return { ok: true as const };
      }
      const user = ctx.session.user;
      await ctx.app.presence.broadcastCursor({
        projectId: input.projectId,
        sessionId: input.sessionId,
        user: {
          id: user.id,
          name: user.name ?? null,
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
    .permission("traces:view")
    .subscription(async function* (opts) {
      const { projectId, anchor, sessionId } = opts.input;

      const app = opts.ctx.app;
      if (!(await app.presence.isEnabledForProject({ projectId }))) {
        return;
      }

      const emitter = app.broadcast.getTenantEmitter(projectId);

      try {
        for await (const eventArgs of on(emitter, "presence_cursor", {
          signal: opts.signal,
        })) {
          const payload = eventArgs[0] as { event: string; timestamp: number };
          let decoded: unknown;
          try {
            decoded = JSON.parse(payload.event);
          } catch {
            continue;
          }
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
        app.broadcast.cleanupTenantEmitter(projectId);
      }
    }),
});
