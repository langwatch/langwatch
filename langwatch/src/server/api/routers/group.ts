import { RoleBindingScopeType, TeamUserRole, type PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { generate } from "@langwatch/ksuid";
import {
  assertEnterprisePlan,
  ENTERPRISE_FEATURE_ERRORS,
} from "../enterprise";
import { checkOrganizationPermission } from "../rbac";
import { assertScopeInOrg } from "./roleBinding";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { slugify } from "~/utils/slugify";
import { KSUID_RESOURCES } from "~/utils/constants";

async function resolveScopeNames(
  prisma: PrismaClient,
  bindings: Array<{ scopeType: RoleBindingScopeType; scopeId: string }>,
): Promise<Map<string, string>> {
  const orgIds = bindings
    .filter((b) => b.scopeType === RoleBindingScopeType.ORGANIZATION)
    .map((b) => b.scopeId);
  const teamIds = bindings
    .filter((b) => b.scopeType === RoleBindingScopeType.TEAM)
    .map((b) => b.scopeId);
  const projectIds = bindings
    .filter((b) => b.scopeType === RoleBindingScopeType.PROJECT)
    .map((b) => b.scopeId);

  const [orgs, teams, projects] = await Promise.all([
    orgIds.length > 0
      ? prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } })
      : [],
    teamIds.length > 0
      ? prisma.team.findMany({ where: { id: { in: teamIds } }, select: { id: true, name: true } })
      : [],
    projectIds.length > 0
      ? prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true } })
      : [],
  ]);

  const map = new Map<string, string>();
  for (const o of orgs) map.set(o.id, o.name);
  for (const t of teams) map.set(t.id, t.name);
  for (const p of projects) map.set(p.id, p.name);
  return map;
}

export const groupRouter = createTRPCRouter({
  /**
   * List all groups in an org with their bindings and member count.
   */
  listAll: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ ctx, input }) => {
      await assertEnterprisePlan({
        organizationId: input.organizationId,
        user: ctx.session.user,
        errorMessage: ENTERPRISE_FEATURE_ERRORS.SCIM,
      });

      const groups = await ctx.prisma.group.findMany({
        where: { organizationId: input.organizationId },
        include: {
          roleBindings: {
            include: { customRole: { select: { id: true, name: true } } },
          },
          _count: { select: { members: true } },
        },
        orderBy: { name: "asc" },
      });

      const allBindings = groups.flatMap((g) => g.roleBindings);
      const scopeNames = await resolveScopeNames(ctx.prisma, allBindings);

      return groups.map((g) => ({
        id: g.id,
        name: g.name,
        slug: g.slug,
        externalId: g.externalId,
        scimSource: g.scimSource,
        memberCount: g._count.members,
        bindings: g.roleBindings.map((b) => ({
          id: b.id,
          role: b.role,
          customRoleId: b.customRoleId,
          customRoleName: b.customRole?.name ?? null,
          scopeType: b.scopeType,
          scopeId: b.scopeId,
          scopeName: scopeNames.get(b.scopeId) ?? null,
        })),
        createdAt: g.createdAt,
      }));
    }),

  /**
   * Get a single group with full member list and bindings.
   */
  getById: protectedProcedure
    .input(z.object({ organizationId: z.string(), groupId: z.string() }))
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ ctx, input }) => {
      const group = await ctx.prisma.group.findFirst({
        where: { id: input.groupId, organizationId: input.organizationId },
        include: {
          roleBindings: {
            include: { customRole: { select: { id: true, name: true } } },
          },
          members: {
            include: { user: { select: { id: true, name: true, email: true } } },
          },
        },
      });

      if (!group) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });
      }

      const scopeNames = await resolveScopeNames(ctx.prisma, group.roleBindings);

      return {
        id: group.id,
        name: group.name,
        slug: group.slug,
        externalId: group.externalId,
        scimSource: group.scimSource,
        bindings: group.roleBindings.map((b) => ({
          id: b.id,
          role: b.role,
          customRoleId: b.customRoleId,
          customRoleName: b.customRole?.name ?? null,
          scopeType: b.scopeType,
          scopeId: b.scopeId,
          scopeName: scopeNames.get(b.scopeId) ?? null,
        })),
        members: group.members.map((m) => ({
          userId: m.userId,
          name: m.user.name,
          email: m.user.email,
        })),
      };
    }),

  /**
   * Create a manual (non-SCIM) group.
   */
  create: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        name: z.string().min(1).max(100),
        bindings: z
          .array(
            z.object({
              role: z.nativeEnum(TeamUserRole),
              customRoleId: z.string().optional(),
              scopeType: z.nativeEnum(RoleBindingScopeType),
              scopeId: z.string(),
            }),
          )
          .optional(),
        memberIds: z.array(z.string()).optional(),
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ ctx, input }) => {
      await assertEnterprisePlan({
        organizationId: input.organizationId,
        user: ctx.session.user,
        errorMessage: ENTERPRISE_FEATURE_ERRORS.SCIM,
      });

      const baseSlug = slugify(input.name, { lower: true, strict: true });

      // Validate all binding scopes belong to this org before starting the transaction
      if (input.bindings?.length) {
        for (const b of input.bindings) {
          await assertScopeInOrg({
            prisma: ctx.prisma,
            organizationId: input.organizationId,
            scopeType: b.scopeType,
            scopeId: b.scopeId,
          });
        }
      }

      return ctx.prisma.$transaction(async (tx) => {
        const existing = await tx.group.count({
          where: {
            organizationId: input.organizationId,
            slug: { startsWith: baseSlug },
          },
        });
        const slug = existing > 0 ? `${baseSlug}-${existing}` : baseSlug;

        const group = await tx.group.create({
          data: { id: generate(KSUID_RESOURCES.GROUP).toString(), organizationId: input.organizationId, name: input.name, slug },
        });

        if (input.bindings?.length) {
          await tx.roleBinding.createMany({
            data: input.bindings.map((b) => ({
              id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
              organizationId: input.organizationId,
              groupId: group.id,
              role: b.role,
              customRoleId: b.role === TeamUserRole.CUSTOM ? (b.customRoleId ?? null) : null,
              scopeType: b.scopeType,
              scopeId: b.scopeId,
            })),
          });
        }

        if (input.memberIds?.length) {
          await tx.groupMembership.createMany({
            data: input.memberIds.map((userId) => ({ groupId: group.id, userId })),
          });
        }

        return group;
      });
    }),

  /**
   * Add a role binding to a group.
   */
  addBinding: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        groupId: z.string(),
        role: z.nativeEnum(TeamUserRole),
        customRoleId: z.string().optional(),
        scopeType: z.nativeEnum(RoleBindingScopeType),
        scopeId: z.string(),
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ ctx, input }) => {
      const group = await ctx.prisma.group.findFirst({
        where: { id: input.groupId, organizationId: input.organizationId },
      });
      if (!group) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });
      }

      await assertScopeInOrg({
        prisma: ctx.prisma,
        organizationId: input.organizationId,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
      });

      return ctx.prisma.roleBinding.create({
        data: {
          id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
          organizationId: input.organizationId,
          groupId: input.groupId,
          role: input.role,
          customRoleId:
            input.role === TeamUserRole.CUSTOM
              ? (input.customRoleId ?? null)
              : null,
          scopeType: input.scopeType,
          scopeId: input.scopeId,
        },
      });
    }),

  /**
   * Remove a role binding from a group.
   */
  removeBinding: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        bindingId: z.string(),
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ ctx, input }) => {
      const binding = await ctx.prisma.roleBinding.findFirst({
        where: { id: input.bindingId, organizationId: input.organizationId },
      });
      if (!binding) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Binding not found" });
      }
      await ctx.prisma.roleBinding.delete({ where: { id: input.bindingId } });
      return { success: true };
    }),

  /**
   * Add a user to a manual group.
   */
  addMember: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        groupId: z.string(),
        userId: z.string(),
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ ctx, input }) => {
      const group = await ctx.prisma.group.findFirst({
        where: { id: input.groupId, organizationId: input.organizationId },
      });
      if (!group) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });
      }
      if (group.scimSource) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot manually add members to a SCIM-managed group",
        });
      }

      const orgMember = await ctx.prisma.organizationUser.findFirst({
        where: { organizationId: input.organizationId, userId: input.userId },
        select: { userId: true },
      });
      if (!orgMember) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User must belong to the organization before joining a group",
        });
      }

      return ctx.prisma.groupMembership.create({
        data: { groupId: input.groupId, userId: input.userId },
      });
    }),

  /**
   * Delete a group and all its memberships and role bindings.
   */
  delete: protectedProcedure
    .input(z.object({ organizationId: z.string(), groupId: z.string() }))
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ ctx, input }) => {
      const group = await ctx.prisma.group.findFirst({
        where: { id: input.groupId, organizationId: input.organizationId },
      });
      if (!group) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });
      }

      await ctx.prisma.groupMembership.deleteMany({ where: { groupId: input.groupId } });
      await ctx.prisma.roleBinding.deleteMany({ where: { groupId: input.groupId } });
      await ctx.prisma.group.delete({ where: { id: input.groupId } });

      return { success: true };
    }),

  /**
   * Remove a user from a manual group.
   */
  rename: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        groupId: z.string(),
        name: z.string().min(1).max(100),
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ ctx, input }) => {
      const group = await ctx.prisma.group.findFirst({
        where: { id: input.groupId, organizationId: input.organizationId },
      });
      if (!group) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });
      }
      if (group.scimSource) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot rename a SCIM-managed group",
        });
      }

      const baseSlug = slugify(input.name, { lower: true, strict: true });
      const existing = await ctx.prisma.group.count({
        where: {
          organizationId: input.organizationId,
          slug: { startsWith: baseSlug },
          id: { not: input.groupId },
        },
      });
      const slug = existing > 0 ? `${baseSlug}-${existing}` : baseSlug;

      return ctx.prisma.group.update({
        where: { id: input.groupId },
        data: { name: input.name, slug },
      });
    }),

  listForMember: protectedProcedure
    .input(z.object({ organizationId: z.string(), userId: z.string() }))
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ ctx, input }) => {
      await assertEnterprisePlan({
        organizationId: input.organizationId,
        user: ctx.session.user,
        errorMessage: ENTERPRISE_FEATURE_ERRORS.SCIM,
      });

      const groups = await ctx.prisma.group.findMany({
        where: {
          organizationId: input.organizationId,
          members: { some: { userId: input.userId } },
        },
        include: {
          roleBindings: {
            include: { customRole: { select: { id: true, name: true } } },
          },
        },
        orderBy: { name: "asc" },
      });

      const allBindings = groups.flatMap((g) => g.roleBindings);
      const scopeNames = await resolveScopeNames(ctx.prisma, allBindings);

      return groups.map((g) => ({
        id: g.id,
        name: g.name,
        scimSource: g.scimSource,
        bindings: g.roleBindings.map((b) => ({
          id: b.id,
          role: b.role,
          customRoleName: b.customRole?.name ?? null,
          scopeType: b.scopeType,
          scopeName: scopeNames.get(b.scopeId) ?? b.scopeId,
        })),
      }));
    }),

  removeMember: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        groupId: z.string(),
        userId: z.string(),
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ ctx, input }) => {
      const group = await ctx.prisma.group.findFirst({
        where: { id: input.groupId, organizationId: input.organizationId },
      });
      if (!group) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });
      }
      if (group.scimSource) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot manually remove members from a SCIM-managed group",
        });
      }

      await ctx.prisma.groupMembership.delete({
        where: { userId_groupId: { userId: input.userId, groupId: input.groupId } },
      });
      return { success: true };
    }),
});
