import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  type PrismaClient,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import type { LedgerActor } from "~/server/app-layer/authz/ledger";
import { GroupRestService } from "~/server/app-layer/groups/group.service";
import { PrismaGroupRepository } from "~/server/app-layer/groups/repositories/group.prisma.repository";
import { PrismaRoleBindingRepository } from "~/server/app-layer/role-bindings/repositories/role-binding.prisma.repository";
import { RoleService } from "~/server/role/role.service";
import { RoleBindingService } from "~/server/role-bindings/role-binding.service";
import { slugify } from "~/utils/slugify";
import { assertEnterprisePlan, ENTERPRISE_FEATURE_ERRORS } from "../enterprise";
import { checkOrganizationPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * The group domain's service, composed the same way the REST surface composes
 * it (`app/api/middleware/group-service.ts`). Every grant a group carries is a
 * ledger fact and the service owns the write: the router validated scopes and
 * custom roles itself and then drove the ledger writer directly, so the two
 * surfaces had two copies of one rule and only one of them was tested.
 */
function groupService(prisma: PrismaClient): GroupRestService {
  return new GroupRestService({
    repo: new PrismaGroupRepository(prisma),
    roleService: new RoleService(prisma),
  });
}

const ledgerActor = (userId: string): LedgerActor => ({
  type: "user",
  id: userId,
});

async function findUniqueGroupSlug(
  prisma: Pick<PrismaClient, "group">,
  organizationId: string,
  baseSlug: string,
  excludeId?: string,
): Promise<string> {
  if (!baseSlug) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Group name cannot be empty after formatting",
    });
  }
  let candidate = baseSlug;
  let suffix = 2;
  while (true) {
    const exists = await prisma.group.findFirst({
      where: {
        organizationId,
        slug: candidate,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (!exists) return candidate;
    candidate = `${baseSlug}-${suffix++}`;
  }
}

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
      ? prisma.organization.findMany({
          where: { id: { in: orgIds } },
          select: { id: true, name: true },
        })
      : [],
    teamIds.length > 0
      ? prisma.team.findMany({
          where: { id: { in: teamIds } },
          select: { id: true, name: true },
        })
      : [],
    projectIds.length > 0
      ? prisma.project.findMany({
          where: { id: { in: projectIds } },
          select: { id: true, name: true },
        })
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
    // Tightened from organization:view to manage — exposes every
    // group's role-binding map (which scopes they grant on, what
    // role, which custom role). Authz config, admin-surface.
    // Sole TS caller is settings/groups.tsx, an admin-only page.
    .use(checkOrganizationPermission("organization:manage"))
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
          _count: {
            select: {
              members: {
                where: {
                  user: {
                    orgMemberships: {
                      some: { organizationId: input.organizationId },
                    },
                  },
                },
              },
            },
          },
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
    // Tightened from organization:view to manage — exposes the
    // member roster (names + emails) and the group's role bindings,
    // both admin-surface authorization data. Sole TS caller is
    // GroupDetailDialog under settings/, an admin-only surface.
    // Mirrors the #47 stack: roleBinding.listForOrg is already at
    // organization:manage; group.getById should match.
    .use(checkOrganizationPermission("organization:manage"))
    .query(async ({ ctx, input }) => {
      const group = await ctx.prisma.group.findFirst({
        where: { id: input.groupId, organizationId: input.organizationId },
        include: {
          roleBindings: {
            include: { customRole: { select: { id: true, name: true } } },
          },
          members: {
            where: {
              user: {
                orgMemberships: {
                  some: { organizationId: input.organizationId },
                },
              },
            },
            include: {
              user: {
                select: { id: true, name: true, email: true, image: true },
              },
            },
          },
        },
      });

      if (!group) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });
      }

      const scopeNames = await resolveScopeNames(
        ctx.prisma,
        group.roleBindings,
      );

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
          image: m.user.image,
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
        name: z.string().trim().min(1, "Group name is required").max(100),
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

      return groupService(ctx.prisma).create({
        organizationId: input.organizationId,
        name: input.name,
        ...(input.bindings ? { bindings: input.bindings } : {}),
        ...(input.memberIds ? { memberIds: input.memberIds } : {}),
        actor: ledgerActor(ctx.session.user.id),
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
      const binding = await groupService(ctx.prisma).addBinding({
        groupId: input.groupId,
        organizationId: input.organizationId,
        role: input.role,
        ...(input.customRoleId ? { customRoleId: input.customRoleId } : {}),
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        actor: ledgerActor(ctx.session.user.id),
      });
      return { id: binding.id };
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
      await groupService(ctx.prisma).removeBinding({
        bindingId: input.bindingId,
        organizationId: input.organizationId,
        actor: ledgerActor(ctx.session.user.id),
      });
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
          message:
            "User must belong to the organization before joining a group",
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
      await groupService(ctx.prisma).delete({
        id: input.groupId,
        organizationId: input.organizationId,
        actor: ledgerActor(ctx.session.user.id),
        // The settings page asks before it gets here ("re-created by your IdP
        // on next sync. Delete anyway?"), which is the answer the API surface
        // has nobody to ask for.
        evenIfDirectoryManaged: true,
      });

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
        name: z.string().trim().min(1, "Group name is required").max(100),
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
      const slug = await findUniqueGroupSlug(
        ctx.prisma,
        input.organizationId,
        baseSlug,
        input.groupId,
      );

      return ctx.prisma.group.update({
        where: { id: input.groupId },
        data: { name: input.name, slug },
      });
    }),

  listForMember: protectedProcedure
    .input(z.object({ organizationId: z.string(), userId: z.string() }))
    // Tightened from organization:view to manage — caller can pass any
    // userId and enumerate which groups that user belongs to (which
    // role bindings they inherit). That's admin-surface authorization
    // visibility. Sole TS caller is MemberDetailDialog under settings/.
    //
    // Deliberately not plan-gated, unlike the group management surfaces:
    // permission resolution honours group bindings on every plan, and the
    // member dialog reads this for every member of every organization, so
    // gating the read either misreports a member's effective access or (as
    // customers hit) turns every dialog open into a refused request. An
    // organization that never had groups simply gets an empty list.
    .use(checkOrganizationPermission("organization:manage"))
    .query(async ({ ctx, input }) => {
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
        where: {
          userId_groupId: { userId: input.userId, groupId: input.groupId },
        },
      });
      return { success: true };
    }),

  /**
   * Atomically apply a batch of edits to a group: rename, binding
   * additions/removals, and member additions/removals. The GroupDetailDialog
   * uses this so a partial failure cannot leave the group half-edited.
   */
  applyEdits: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        groupId: z.string(),
        rename: z
          .object({
            name: z.string().trim().min(1).max(100),
          })
          .nullable()
          .optional(),
        bindingIdsToDelete: z.array(z.string()),
        bindingsToCreate: z.array(
          z.object({
            role: z.nativeEnum(TeamUserRole),
            customRoleId: z.string().optional(),
            scopeType: z.nativeEnum(RoleBindingScopeType),
            scopeId: z.string(),
          }),
        ),
        memberUserIdsToAdd: z.array(z.string()),
        memberUserIdsToRemove: z.array(z.string()),
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ ctx, input }) => {
      let resolvedRename: { name: string; slug: string } | null = null;
      if (input.rename) {
        const baseSlug = slugify(input.rename.name, {
          lower: true,
          strict: true,
        });
        const slug = await findUniqueGroupSlug(
          ctx.prisma,
          input.organizationId,
          baseSlug,
          input.groupId,
        );
        resolvedRename = { name: input.rename.name, slug };
      }

      const repo = new PrismaRoleBindingRepository(ctx.prisma);
      const roleService = new RoleService(ctx.prisma);
      const service = new RoleBindingService({
        prisma: ctx.prisma,
        repo,
        roleService,
      });
      return service.applyGroupEdits({
        organizationId: input.organizationId,
        actor: { type: "user", id: ctx.session.user.id },
        groupId: input.groupId,
        rename: resolvedRename,
        bindingIdsToDelete: input.bindingIdsToDelete,
        bindingsToCreate: input.bindingsToCreate,
        memberUserIdsToAdd: input.memberUserIdsToAdd,
        memberUserIdsToRemove: input.memberUserIdsToRemove,
      });
    }),
});
