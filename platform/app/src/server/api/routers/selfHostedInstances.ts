import { auditLog } from "@ee/audit-log/auditLog";
import { createSelfHostedInstanceService } from "@ee/telemetry/instances/composition";
import { z } from "zod";
import { prisma } from "~/server/db";
import { adminSurfaceHidden } from "../../../../ee/admin/adminSurfaceHidden";
import { isAdmin as checkIsAdmin } from "../../../../ee/admin/isAdmin";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * The backoffice's registry of self-hosted installs (ADR-141, section 10).
 *
 * Gated like the license registry beside it: the `ADMIN_EMAILS` staff list
 * checked in the handler, never an RBAC permission, and denial is the shared
 * 404 that says nothing about why. Reading it is cross-tenant by design, which
 * is the point of a distribution list.
 *
 * Read only. Everything on these rows was written by the public report
 * receiver, and an operator changing a number an install reported would leave
 * the registry saying something no install ever said.
 */

const NO_PERMISSION = {
  reason:
    "back-office surface gated on the ADMIN_EMAILS staff list, not on an RBAC permission; cross-tenant by design",
} as const;

function requireOperator(user: { id: string; email?: string | null }): {
  userId: string;
} {
  if (!checkIsAdmin(user)) throw adminSurfaceHidden();
  return { userId: user.id };
}

const service = () => createSelfHostedInstanceService(prisma);

export const selfHostedInstancesRouter = createTRPCRouter({
  getAll: protectedProcedure
    .input(
      z.object({
        page: z.number().int().min(0).default(0),
        pageSize: z.number().int().min(1).max(100).default(25),
        search: z.string().max(200).optional(),
      }),
    )
    .noPermission(NO_PERMISSION)
    .query(async ({ ctx, input }) => {
      const operator = requireOperator(
        ctx.session.user.impersonator ?? ctx.session.user,
      );
      await auditLog({
        userId: operator.userId,
        action: "selfHostedInstances.getAll",
        args: {
          page: input.page,
          pageSize: input.pageSize,
          hasSearch: Boolean(input.search),
        },
        targetKind: "selfHostedInstance",
      });
      return service().getAll(input);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .noPermission(NO_PERMISSION)
    .query(async ({ ctx, input }) => {
      const operator = requireOperator(
        ctx.session.user.impersonator ?? ctx.session.user,
      );
      await auditLog({
        userId: operator.userId,
        action: "selfHostedInstances.getById",
        args: { id: input.id },
        targetKind: "selfHostedInstance",
        targetId: input.id,
      });
      return service().getById(input);
    }),
});
