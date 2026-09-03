import { auditLog } from "@ee/audit-log/auditLog";
import { z } from "zod";
import { scimOversight } from "~/server/app-layer/identity/runtime";
import { adminSurfaceHidden } from "../../../../ee/admin/adminSurfaceHidden";
import { isAdmin as checkIsAdmin } from "../../../../ee/admin/isAdmin";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * The back office's directory-sync oversight (ADR-122).
 *
 * The `ssoConnections` router's shape, and for the same reasons: gating is the
 * back office's existing gating (`ADMIN_EMAILS` plus an in-handler `isAdmin`)
 * rather than an RBAC permission, denial is a 404 byte-identical to an
 * unregistered path so the surface does not confirm its own existence, and
 * the one act it offers is a guarded command with the operator recorded on it
 * rather than a row this router writes.
 *
 * `ops:*` is deliberately NOT the gate. It is the registry's only
 * platform-scope resource and never reaches `.permission()`; more to the
 * point, if it ever widens to a broader operator population, whose hand may
 * re-drive a customer's failed deprovision must not widen with it by
 * accident.
 */

const NO_PERMISSION = {
  reason:
    "back-office surface gated on the ADMIN_EMAILS staff list, not on an RBAC permission; cross-tenant by design",
} as const;

/** The operator, or a 404 that says nothing about why. */
function requireOperator(user: { id: string; email?: string | null }): {
  userId: string;
} {
  if (!checkIsAdmin(user)) throw adminSurfaceHidden();
  return { userId: user.id };
}

/**
 * Gate, then record, then act — the `ssoConnections` ordering. The record
 * lands before the command so that an act which then failed is still in the
 * trail, which is the half worth having.
 */
async function audited({
  ctx,
  action,
  args,
}: {
  ctx: {
    session: {
      user: {
        id: string;
        email?: string | null;
        impersonator?: { id: string; email?: string | null };
      };
    };
  };
  action: string;
  args: Record<string, unknown>;
}): Promise<{ userId: string }> {
  const user = ctx.session.user.impersonator ?? ctx.session.user;
  const operator = requireOperator(user);
  await auditLog({
    userId: operator.userId,
    action: `scimOversight.${action}`,
    args,
    targetKind: "scimSync",
    targetId:
      typeof args.connectionId === "string" ? args.connectionId : undefined,
  });
  return operator;
}

export const scimOversightRouter = createTRPCRouter({
  getAll: protectedProcedure
    .input(
      z.object({
        page: z.number().int().min(0).default(0),
        pageSize: z.number().int().min(1).max(100).default(25),
        search: z.string().max(253).optional(),
      }),
    )
    .noPermission(NO_PERMISSION)
    .query(async ({ ctx, input }) => {
      await audited({ ctx, action: "getAll", args: { page: input.page } });
      return scimOversight().getAll(input);
    }),

  getById: protectedProcedure
    .input(z.object({ connectionId: z.string().min(1) }))
    .noPermission(NO_PERMISSION)
    .query(async ({ ctx, input }) => {
      await audited({ ctx, action: "getById", args: { ...input } });
      return scimOversight().getById(input);
    }),

  directoryIdentities: protectedProcedure
    .input(z.object({ connectionId: z.string().min(1) }))
    .noPermission(NO_PERMISSION)
    .query(async ({ ctx, input }) => {
      // Recorded like every other read of somebody else's data on this
      // surface: the mapping detail is the thing the organization view will
      // never show, so who looked at it is worth keeping.
      await audited({ ctx, action: "directoryIdentities", args: { ...input } });
      return scimOversight().getDirectoryIdentities(input);
    }),

  redriveRetiredApply: protectedProcedure
    .input(
      z.object({
        connectionId: z.string().min(1),
        /** Which dead letter, by the business time it was retired at. */
        retiredAtMs: z.number().int().nonnegative(),
      }),
    )
    .noPermission(NO_PERMISSION)
    .mutation(async ({ ctx, input }) => {
      const operator = await audited({
        ctx,
        action: "redriveRetiredApply",
        args: { ...input },
      });
      return scimOversight().redriveRetiredApply({ ...input, operator });
    }),
});
