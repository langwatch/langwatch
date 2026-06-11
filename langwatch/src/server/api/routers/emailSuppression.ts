import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getApp } from "~/server/app-layer/app";
import {
  confirmUnsubscribe,
  InvalidUnsubscribeTokenError,
  resolveUnsubscribe,
} from "~/server/mailer/unsubscribe.read";
import { getClientIp } from "~/utils/getClientIp";
import { auditLog } from "../../auditLog";
import { rateLimit } from "../../rateLimit";
import { checkProjectPermission, skipPermissionCheck } from "../rbac";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";

/**
 * ADR-031: the unsubscribe procedures are public (the token is the only
 * authorization), so they are an unauthenticated surface an attacker can
 * hammer to brute-force tokens or exhaust the mail/DB path. Keyed by client
 * IP — falls back to a shared bucket when the IP is unknown so a missing
 * header still throttles rather than bypasses.
 */
async function enforceUnsubscribeRateLimit({
  ip,
  action,
  max,
}: {
  ip: string | undefined;
  action: string;
  max: number;
}): Promise<void> {
  const limit = await rateLimit({
    key: `unsubscribe:${action}:${ip ?? "unknown"}`,
    windowSeconds: 60,
    max,
  });
  if (!limit.allowed) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Too many requests. Please try again shortly.",
    });
  }
}

export const emailSuppressionRouter = createTRPCRouter({
  /**
   * ADR-031: public token resolution for the `/unsubscribe` page. The token is
   * the authorization — its HMAC binds it to one recipient — so no login is
   * required. Returns masked email + project/trigger names, or NOT_FOUND on an
   * invalid/tampered token or a project that no longer exists.
   */
  resolveUnsubscribeToken: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .use(skipPermissionCheck)
    .query(async ({ input, ctx }) => {
      await enforceUnsubscribeRateLimit({
        ip: getClientIp(ctx.req),
        action: "resolve",
        max: 30,
      });
      const view = await resolveUnsubscribe({
        token: input.token,
        deps: {
          lookupNames: async ({ projectId, triggerId }) => {
            const project = await ctx.prisma.project.findFirst({
              where: { id: projectId },
              select: { name: true },
            });
            if (!project) return null;
            const trigger =
              triggerId != null
                ? await ctx.prisma.trigger.findFirst({
                    where: { id: triggerId, projectId },
                    select: { name: true },
                  })
                : null;
            return {
              projectName: project.name,
              triggerName: trigger?.name ?? null,
            };
          },
        },
      });
      if (!view) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This unsubscribe link is invalid or has expired.",
        });
      }
      return view;
    }),

  /** Public one-click / button confirm. Idempotent — the suppression upsert
   *  collapses duplicates. */
  confirmUnsubscribe: publicProcedure
    .input(
      z.object({
        token: z.string().min(1),
        scope: z.enum(["trigger", "project"]),
      }),
    )
    .use(skipPermissionCheck)
    .mutation(async ({ input, ctx }) => {
      await enforceUnsubscribeRateLimit({
        ip: getClientIp(ctx.req),
        action: "confirm",
        max: 10,
      });
      try {
        await confirmUnsubscribe({
          token: input.token,
          scope: input.scope,
          deps: {
            suppress: ({ projectId, email, triggerId }) =>
              getApp().emailSuppressions.suppress({
                projectId,
                email,
                triggerId,
                reason: "unsubscribe",
              }),
          },
        });
      } catch (err) {
        // A bad/tampered token is the recipient's problem (4xx); a downstream
        // persistence failure is ours (5xx) and must not masquerade as an
        // "invalid link".
        if (err instanceof InvalidUnsubscribeTokenError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This unsubscribe link is invalid.",
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Could not process unsubscribe. Please try again.",
        });
      }
      return { ok: true };
    }),

  /** Operator-facing suppression list (ADR-031). Each row is enriched with its
   *  trigger name (null triggerId = project-wide) so the table can render the
   *  scope without a second round-trip. */
  getAll: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("triggers:view"))
    .query(async ({ input, ctx }) => {
      const rows = await getApp().emailSuppressions.getAllForProject({
        projectId: input.projectId,
      });
      const triggerIds = [
        ...new Set(
          rows
            .map((r) => r.triggerId)
            .filter((id): id is string => id != null),
        ),
      ];
      const triggers =
        triggerIds.length > 0
          ? await ctx.prisma.trigger.findMany({
              where: { id: { in: triggerIds }, projectId: input.projectId },
              select: { id: true, name: true },
            })
          : [];
      const nameById = new Map(triggers.map((t) => [t.id, t.name]));
      void auditLog({
        userId: ctx.session.user.id,
        projectId: input.projectId,
        action: "emailSuppression.getAll",
        args: { recordCount: rows.length, triggerIds },
      });
      return rows.map((r) => ({
        id: r.id,
        email: r.email,
        triggerId: r.triggerId,
        triggerName: r.triggerId != null ? nameById.get(r.triggerId) ?? null : null,
        reason: r.reason,
        createdAt: r.createdAt,
      }));
    }),

  /** Removing a suppression resumes delivery — a deliberate operator action. */
  remove: protectedProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .use(checkProjectPermission("triggers:manage"))
    .mutation(async ({ input, ctx }) => {
      await getApp().emailSuppressions.remove({
        projectId: input.projectId,
        id: input.id,
      });
      void auditLog({
        userId: ctx.session.user.id,
        projectId: input.projectId,
        action: "emailSuppression.remove",
        args: { suppressionId: input.id },
      });
      return { ok: true };
    }),
});
