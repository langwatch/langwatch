import { z } from "zod";
import { getApp } from "~/server/app-layer/app";
import { authorizeInResolver } from "~/server/app-layer/authz/permission-adapters";
import { authz, authzCollector } from "~/server/app-layer/authz/runtime";
import { aggregatesClosedTo } from "~/server/app-layer/permissions/aggregate-admin-gate";
import { isAggregateProjectKind } from "~/server/app-layer/projects/project-kinds";
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
    .use(
      authorizeInResolver({
        projectId:
          "resolves the caller's OWN effective permissions at this scope; a non-member resolves to the empty set (no default access)",
        organizationId:
          "resolves the caller's OWN effective permissions at this scope; a non-member resolves to the empty set (no default access)",
      }),
    )
    .query(async ({ ctx, input }) => {
      const scope = await authzCollector.resolveScopeRef({
        projectId: input.projectId,
        organizationId: input.projectId ? undefined : input.organizationId,
      });
      if (!scope) {
        return { scope: null, permissions: [] as string[] };
      }
      // ADR-144 decision 5: only an organisation admin opens an aggregate,
      // so anyone else is told they may do nothing there. The kind is read
      // first (cached) so ordinary projects never pay for the role read.
      if (
        scope.type === "project" &&
        isAggregateProjectKind(await getApp().projectKinds.kindOf(scope.id))
      ) {
        const app = getApp();
        const closed = await aggregatesClosedTo({
          projectIds: [scope.id],
          organizationRole: await app.organizations.getUserOrgRole({
            userId: ctx.session.user.id,
            organizationId: scope.organizationId,
          }),
          kinds: app.projectKinds,
        });
        if (closed.has(scope.id)) {
          return {
            scope: { type: scope.type, id: scope.id },
            permissions: [] as string[],
          };
        }
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
