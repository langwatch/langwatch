import type { LedgerActor } from "@langwatch/actor";
import {
  organizationGroupBindingInputSchema,
  type OrganizationGroupBinding,
} from "@langwatch/organization-contract";
import { z } from "zod";
import type { RequestAppServices } from "~/runtime/app/requestApp";
import { assertEnterprisePlan, ENTERPRISE_FEATURE_ERRORS } from "../enterprise";
import { createTRPCRouter, protectedProcedure } from "../trpc";

const ledgerActor = (userId: string): LedgerActor => ({
  type: "user",
  id: userId,
});

async function resolveScopeNames(
  app: RequestAppServices,
  organizationId: string,
  bindings: OrganizationGroupBinding[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const uniqueBindings = [
    ...new Map(bindings.map((binding) => [binding.scopeId, binding])).values(),
  ];
  await Promise.all(
    uniqueBindings.map(async (binding) => {
      if (binding.scopeType === "ORGANIZATION") {
        const organization = await app.organizations.getBillingProfile({
          organizationId,
        });
        names.set(binding.scopeId, organization.name);
        return;
      }
      if (binding.scopeType === "TEAM") {
        const team = await app.organizations.getTeam({
          organizationId,
          teamId: binding.scopeId,
        });
        names.set(binding.scopeId, team.name);
        return;
      }
      const project = await app.projects.tryGetById(binding.scopeId);
      if (project) names.set(binding.scopeId, project.name);
    }),
  );
  return names;
}

export const groupRouter = createTRPCRouter({
  listAll: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .permission("organization:manage")
    .query(async ({ ctx, input }) => {
      await assertEnterprisePlan({
        planProvider: ctx.app.planProvider,
        organizationId: input.organizationId,
        user: ctx.session.user,
        errorMessage: ENTERPRISE_FEATURE_ERRORS.SCIM,
      });
      const page = await ctx.app.organizations.listGroups({
        organizationId: input.organizationId,
        page: 1,
        limit: 1_000,
      });
      const allBindings = page.data.flatMap(({ bindings }) => bindings);
      const scopeNames = await resolveScopeNames(
        ctx.app,
        input.organizationId,
        allBindings,
      );
      return page.data.map((group) => ({
        id: group.id,
        name: group.name,
        slug: group.slug,
        externalId: group.externalId,
        scimSource: group.scimSource,
        memberCount: group.memberCount,
        bindings: group.bindings.map((binding) => ({
          ...binding,
          scopeName: scopeNames.get(binding.scopeId) ?? null,
        })),
        createdAt: group.createdAt,
      }));
    }),

  getById: protectedProcedure
    .input(z.object({ organizationId: z.string(), groupId: z.string() }))
    .permission("organization:manage")
    .query(async ({ ctx, input }) => {
      const group = await ctx.app.organizations.getGroup(input);
      const scopeNames = await resolveScopeNames(
        ctx.app,
        input.organizationId,
        group.bindings,
      );
      return {
        id: group.id,
        name: group.name,
        slug: group.slug,
        externalId: group.externalId,
        scimSource: group.scimSource,
        bindings: group.bindings.map((binding) => ({
          ...binding,
          scopeName: scopeNames.get(binding.scopeId) ?? null,
        })),
        members: group.members,
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        name: z.string().trim().min(1, "Group name is required").max(100),
        bindings: z.array(organizationGroupBindingInputSchema).optional(),
        memberIds: z.array(z.string()).optional(),
      }),
    )
    .permission("organization:manage")
    .mutation(async ({ ctx, input }) => {
      await assertEnterprisePlan({
        planProvider: ctx.app.planProvider,
        organizationId: input.organizationId,
        user: ctx.session.user,
        errorMessage: ENTERPRISE_FEATURE_ERRORS.SCIM,
      });
      return ctx.app.organizations.createGroup({
        ...input,
        actor: ledgerActor(ctx.session.user.id),
      });
    }),

  addBinding: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        groupId: z.string(),
        ...organizationGroupBindingInputSchema.shape,
      }),
    )
    .permission("organization:manage")
    .mutation(async ({ ctx, input }) => {
      const { organizationId, groupId, ...binding } = input;
      const created = await ctx.app.organizations.addGroupBinding({
        organizationId,
        groupId,
        binding,
        actor: ledgerActor(ctx.session.user.id),
      });
      return { id: created.id };
    }),

  removeBinding: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        bindingId: z.string(),
      }),
    )
    .permission("organization:manage")
    .mutation(async ({ ctx, input }) => {
      await ctx.app.organizations.removeGroupBinding({
        ...input,
        actor: ledgerActor(ctx.session.user.id),
      });
      return { success: true };
    }),

  addMember: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        groupId: z.string(),
        userId: z.string(),
      }),
    )
    .permission("organization:manage")
    .mutation(async ({ ctx, input }) => {
      await ctx.app.organizations.addGroupMember(input);
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ organizationId: z.string(), groupId: z.string() }))
    .permission("organization:manage")
    .mutation(async ({ ctx, input }) => {
      await ctx.app.organizations.deleteGroup({
        ...input,
        actor: ledgerActor(ctx.session.user.id),
        allowScimManaged: true,
      });
      return { success: true };
    }),

  rename: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        groupId: z.string(),
        name: z.string().trim().min(1, "Group name is required").max(100),
      }),
    )
    .permission("organization:manage")
    .mutation(({ ctx, input }) => ctx.app.organizations.renameGroup(input)),

  listForMember: protectedProcedure
    .input(z.object({ organizationId: z.string(), userId: z.string() }))
    .permission("organization:manage")
    .query(async ({ ctx, input }) => {
      const groups = await ctx.app.organizations.listGroupsForMember(input);
      const allBindings = groups.flatMap(({ bindings }) => bindings);
      const scopeNames = await resolveScopeNames(
        ctx.app,
        input.organizationId,
        allBindings,
      );
      return groups.map((group) => ({
        id: group.id,
        name: group.name,
        scimSource: group.scimSource,
        bindings: group.bindings.map((binding) => ({
          id: binding.id,
          role: binding.role,
          customRoleName: binding.customRoleName,
          scopeType: binding.scopeType,
          scopeName: scopeNames.get(binding.scopeId) ?? binding.scopeId,
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
    .permission("organization:manage")
    .mutation(async ({ ctx, input }) => {
      await ctx.app.organizations.removeGroupMember(input);
      return { success: true };
    }),

  applyEdits: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        groupId: z.string(),
        rename: z
          .object({ name: z.string().trim().min(1).max(100) })
          .nullable()
          .optional(),
        bindingIdsToDelete: z.array(z.string()),
        bindingsToCreate: z.array(organizationGroupBindingInputSchema),
        memberUserIdsToAdd: z.array(z.string()),
        memberUserIdsToRemove: z.array(z.string()),
      }),
    )
    .permission("organization:manage")
    .mutation(async ({ ctx, input }) => {
      await ctx.app.organizations.applyGroupEdits({
        ...input,
        actor: ledgerActor(ctx.session.user.id),
      });
      return { success: true };
    }),
});
