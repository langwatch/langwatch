import { z } from "zod";
import { authz, authzCollector } from "~/server/authz/runtime";
import { authorizeInResolver } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * ADR-092 §5/§11 — the frontend's single source of truth for "what may I
 * do here". Computes the CALLER's own effective permission set at a scope;
 * it never answers for other principals, so membership itself is the only
 * requirement (non-members simply resolve to an empty set — the engine's
 * no-default-access does the gating).
 */
export const authzRouter = createTRPCRouter({
  effectivePermissions: protectedProcedure
    .input(
      z.object({
        projectId: z.string().optional(),
        organizationId: z.string().optional(),
      }),
    )
    .use(authorizeInResolver)
    .query(async ({ ctx, input }) => {
      const scope = await authzCollector.resolveScopeRef({
        projectId: input.projectId,
        organizationId: input.projectId ? undefined : input.organizationId,
      });
      if (!scope) {
        return { scope: null, permissions: [] as string[] };
      }
      const permissions = await authz.effectivePermissions({
        principal: { type: "user", id: ctx.session.user.id },
        scope,
      });
      return {
        scope: { type: scope.type, id: scope.id },
        permissions,
      };
    }),
});
