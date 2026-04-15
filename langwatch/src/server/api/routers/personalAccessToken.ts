import { RoleBindingScopeType, TeamUserRole } from "@prisma/client";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { PatService } from "~/server/pat/pat.service";
import { checkRoleBindingPermission } from "~/server/rbac/role-binding-resolver";
import { skipPermissionCheck } from "../rbac";

const roleBindingSchema = z.object({
  role: z.nativeEnum(TeamUserRole),
  customRoleId: z.string().nullish(),
  scopeType: z.nativeEnum(RoleBindingScopeType),
  scopeId: z.string(),
});

export const personalAccessTokenRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(
      skipPermissionCheck({
        allow: { organizationId: "listing user's own PATs" },
      }),
    )
    .query(async ({ ctx, input }) => {
      const patService = PatService.create(ctx.prisma);
      const pats = await patService.list({
        userId: ctx.session.user.id,
        organizationId: input.organizationId,
      });

      return pats.map((pat) => ({
        id: pat.id,
        name: pat.name,
        createdAt: pat.createdAt,
        lastUsedAt: pat.lastUsedAt,
        revokedAt: pat.revokedAt,
        roleBindings: pat.roleBindings.map((rb) => ({
          id: rb.id,
          role: rb.role,
          customRoleId: rb.customRoleId,
          scopeType: rb.scopeType,
          scopeId: rb.scopeId,
        })),
      }));
    }),

  create: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        name: z.string().min(1).max(100),
        bindings: z.array(roleBindingSchema).min(1),
      }),
    )
    .use(
      skipPermissionCheck({
        allow: { organizationId: "creating PAT for user's own org" },
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Validate that the user is a member of this org
      const orgUser = await ctx.prisma.organizationUser.findFirst({
        where: {
          userId: ctx.session.user.id,
          organizationId: input.organizationId,
        },
      });
      if (!orgUser) {
        throw new Error("Not a member of this organization");
      }

      // Validate that requested bindings don't exceed the user's own permissions.
      // For each binding, verify the user has the same or higher permission at that scope.
      for (const binding of input.bindings) {
        const scope =
          binding.scopeType === RoleBindingScopeType.ORGANIZATION
            ? ({ type: "org" as const, id: binding.scopeId })
            : binding.scopeType === RoleBindingScopeType.TEAM
              ? ({ type: "team" as const, id: binding.scopeId })
              : await (async () => {
                  const project = await ctx.prisma.project.findUnique({
                    where: { id: binding.scopeId },
                    select: { teamId: true },
                  });
                  if (!project) throw new Error(`Project ${binding.scopeId} not found`);
                  return { type: "project" as const, id: binding.scopeId, teamId: project.teamId };
                })();

        // Check that the user has the permission that this role grants
        const userHasPermission = await checkRoleBindingPermission({
          prisma: ctx.prisma,
          principal: { type: "user", id: ctx.session.user.id },
          organizationId: input.organizationId,
          scope,
          // Check if user has at least manage permission at the scope
          // (if they're assigning ADMIN, they need manage; otherwise view suffices)
          permission:
            binding.role === TeamUserRole.ADMIN
              ? "project:manage"
              : "project:view",
        });

        if (!userHasPermission) {
          throw new Error(
            `Cannot create PAT with permissions exceeding your own at scope ${binding.scopeType}:${binding.scopeId}`,
          );
        }
      }

      const patService = PatService.create(ctx.prisma);
      const { token, pat } = await patService.create({
        name: input.name,
        userId: ctx.session.user.id,
        organizationId: input.organizationId,
        bindings: input.bindings,
      });

      // Return token (shown once) plus metadata
      return {
        token,
        pat: {
          id: pat.id,
          name: pat.name,
          createdAt: pat.createdAt,
        },
      };
    }),

  revoke: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        patId: z.string(),
      }),
    )
    .use(
      skipPermissionCheck({
        allow: { organizationId: "revoking user's own PAT" },
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const patService = PatService.create(ctx.prisma);
      await patService.revoke({
        id: input.patId,
        userId: ctx.session.user.id,
      });
      return { success: true };
    }),
});
