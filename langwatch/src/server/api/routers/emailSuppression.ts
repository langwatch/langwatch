import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getApp } from "~/server/app-layer/app";
import {
  confirmUnsubscribe,
  resolveUnsubscribe,
} from "~/server/mailer/unsubscribe.read";
import { checkProjectPermission, skipPermissionCheck } from "../rbac";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";

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
    .mutation(async ({ input }) => {
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
      } catch {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This unsubscribe link is invalid.",
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
    .mutation(async ({ input }) => {
      await getApp().emailSuppressions.remove({
        projectId: input.projectId,
        id: input.id,
      });
      return { ok: true };
    }),
});
