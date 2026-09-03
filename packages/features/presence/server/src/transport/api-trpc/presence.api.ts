import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  presenceCursorAnchorSchema,
  presenceCursorInputSchema,
  presenceLeaveInputSchema,
  presenceProjectInputSchema,
  presenceUpdateInputSchema,
  type PresenceService,
  type PresenceUser,
} from "@langwatch/presence-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import type { PresenceEmitterPort } from "../../ports/presence.port";
import { PresenceStreamService } from "../../services/presence-stream.service";

type PresenceApplication = Readonly<{
  presence: PresenceService;
  broadcast: PresenceEmitterPort;
}>;

/** The process supplies authentication; authorization arrives as `policy`. */
export type PresenceTrpcContext = Readonly<{
  app: PresenceApplication;
  actor(): Readonly<{ id: string }>;
  /**
   * Presence renders the person, not just their id, so the display fields the
   * peers see are read from the authenticated session — never from the
   * payload, which would let a client impersonate another user.
   */
  session: Readonly<{
    user: Readonly<{ id: string; name?: string | null; image?: string | null }>;
  }> | null;
}>;

type PresenceTrpcProcedures<
  TContext extends PresenceTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's tracing, logging, error, scope-lineage, authorization and
   * audit policy for one declared permission.
   *
   * Applied by this feature AFTER its own input parser rather than composed
   * ahead of it, because the authorization check reads its scope id from the
   * validated input: tRPC runs middlewares in the order they were added, so a
   * check installed before `.input()` would see no input at all.
   */
  policy(permission: AuthzPermission): <TProcedure>(procedure: TProcedure) => TProcedure;
}>;

/**
 * Presence is a read-side view of who else is looking at the same project, so
 * seeing it — and being seen in it — takes exactly what seeing the traces
 * takes. Every procedure declares this one permission at the project tier.
 */
const PRESENCE_PERMISSION: AuthzPermission = "traces:view";

const cursorSubscriptionInputSchema = presenceProjectInputSchema.extend({
  anchor: presenceCursorAnchorSchema,
  sessionId: z.string().min(1),
});

/**
 * The presenting identity of the caller. `actor()` proves a session exists
 * before the display fields are read, so an unauthenticated call is refused
 * here rather than publishing a nameless session.
 */
function presenceUserOf(ctx: PresenceTrpcContext): PresenceUser {
  const { id } = ctx.actor();
  const user = ctx.session?.user;
  return { id, name: user?.name ?? null, image: user?.image ?? null };
}

function streamsOf(ctx: PresenceTrpcContext): PresenceStreamService {
  return PresenceStreamService.create({
    presence: ctx.app.presence,
    emitters: ctx.app.broadcast,
  });
}

/**
 * Installs the complete `presence.*` tRPC surface on a process-owned root.
 * The procedure and the policy are injected by the process so its auth,
 * audit, error, logging and tracing policies wrap every feature procedure
 * consistently.
 */
export class PresenceTrpcApi {
  static create<
    TContext extends PresenceTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: PresenceTrpcProcedures<TContext, TOptions, TRoot>,
  ) {
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      /**
       * Heartbeat + location update for a single browser session.
       *
       * The userId is taken from the authenticated session — clients cannot
       * impersonate another user by setting it in the payload.
       */
      update: policy(PRESENCE_PERMISSION)(
        procedure.input(presenceUpdateInputSchema.omit({ user: true })),
      ).mutation(async ({ ctx, input }) => {
        if (!(await ctx.app.presence.isEnabledForProject({ projectId: input.projectId }))) {
          return { ok: true as const };
        }
        await ctx.app.presence.update({
          projectId: input.projectId,
          sessionId: input.sessionId,
          user: presenceUserOf(ctx),
          location: input.location,
        });
        return { ok: true as const };
      }),

      /** Remove a session immediately and notify peers. */
      leave: policy(PRESENCE_PERMISSION)(procedure.input(presenceLeaveInputSchema)).mutation(
        async ({ ctx, input }) => {
          if (!(await ctx.app.presence.isEnabledForProject({ projectId: input.projectId }))) {
            return { ok: true as const };
          }
          await ctx.app.presence.leave({
            projectId: input.projectId,
            sessionId: input.sessionId,
          });
          return { ok: true as const };
        },
      ),

      /**
       * Subscribe to presence updates for a project. Yields one snapshot event
       * on connect, then deltas (`join`, `update`, `leave`) until the client
       * disconnects.
       */
      onPresenceUpdate: policy(PRESENCE_PERMISSION)(
        procedure.input(presenceProjectInputSchema),
      ).subscription(async function* (opts) {
        const { projectId } = opts.input;
        yield* streamsOf(opts.ctx).events({ projectId, signal: opts.signal });
      }),

      /**
       * High-frequency cursor tick. Fire-and-forget — server drops the event
       * silently if the per-tenant rate-limit bucket is exhausted.
       */
      cursor: policy(PRESENCE_PERMISSION)(
        procedure.input(presenceCursorInputSchema.omit({ user: true })),
      ).mutation(async ({ ctx, input }) => {
        if (!(await ctx.app.presence.isEnabledForProject({ projectId: input.projectId }))) {
          return { ok: true as const };
        }
        await ctx.app.presence.broadcastCursor({
          projectId: input.projectId,
          sessionId: input.sessionId,
          user: presenceUserOf(ctx),
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
      onPresenceCursor: policy(PRESENCE_PERMISSION)(
        procedure.input(cursorSubscriptionInputSchema),
      ).subscription(async function* (opts) {
        const { projectId, anchor, sessionId } = opts.input;
        yield* streamsOf(opts.ctx).cursors({
          projectId,
          anchor,
          sessionId,
          signal: opts.signal,
        });
      }),
    });
  }
}
