/**
 * A group over the process's tRPC transport. Every procedure takes `organization:manage`, since
 * a group is an access grant. Groups arrive with SCIM, so create/list are gated on the Enterprise
 * plan port. Transport only: gates, plan enforcement, delegation to {@link OrganizationApi}.
 */
import { createTrpcService } from "@langwatch/api/trpc";
import type { AuthzDeclaration } from "@langwatch/authz-contract";
import {
  groupApiAddBindingInputSchema,
  groupApiApplyEditsInputSchema,
  groupApiCreateInputSchema,
  groupApiGroupScopeSchema,
  groupApiMemberInputSchema,
  groupApiMemberScopeSchema,
  groupApiRemoveBindingInputSchema,
  groupApiRenameInputSchema,
  groupBindingCreatedSchema,
  groupDetailSchema,
  groupListItemSchema,
  groupMembershipViewSchema,
  groupWriteAckSchema,
  organizationApiScopeSchema,
  organizationGroupSchema,
  type OrganizationGroupBinding,
} from "@langwatch/organization-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import type { OrganizationApi } from "@langwatch/organization-contract";

/**
 * The process supplies authentication; authorization arrives as `policy`. `app` is the slice of
 * the process's application this feature reaches, since a shared tRPC root carries every feature.
 */
export type GroupTrpcContext = Readonly<{
  app: Readonly<{ organizations: OrganizationApi }>;
  actor(): Readonly<{ id: string }>;
}>;

type GroupTrpcProcedures<
  TContext extends GroupTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /** The process's tracing/logging/error/authorization/audit policy for one access declaration.
   * Applied after this feature's own input parser, since the check reads its scope id from it. */
  policy(declaration: AuthzDeclaration): <TProcedure>(procedure: TProcedure) => TProcedure;
  /** @see the mount field of the same name. */
  validateOutput: boolean;
}>;

/** The process capabilities this transport needs that are not the group's own. */
export type GroupTrpcPorts = Readonly<{
  /**
   * Refuses the call when the organization's plan does not carry SCIM.
   * Throws; a refusal is never turned into a different answer here.
   */
  assertScimAllowed(
    ctx: GroupTrpcContext,
    input: Readonly<{ organizationId: string }>,
  ): Promise<void>;
}>;

/** The page size the group list is read at. */
const GROUP_PAGE = { page: 1, limit: 1_000 } as const;

const ORGANIZATION_MANAGE: AuthzDeclaration = {
  kind: "permission",
  permission: "organization:manage",
};

/** Resolves one binding's scope id to the name an admin reads, keeping every other field as-is. */
function withResolvedScopeName(scopeNames: ReadonlyMap<string, string>) {
  return (binding: OrganizationGroupBinding) => ({
    ...binding,
    scopeName: scopeNames.get(binding.scopeId) ?? null,
  });
}

/** The member drawer's binding shape: named fields only, scope id dropped for its resolved name. */
function toGroupMembershipBinding(scopeNames: ReadonlyMap<string, string>) {
  return (binding: OrganizationGroupBinding) => ({
    id: binding.id,
    role: binding.role,
    customRoleName: binding.customRoleName,
    scopeType: binding.scopeType,
    scopeName: scopeNames.get(binding.scopeId) ?? binding.scopeId,
  });
}

/**
 * Installs the complete `group.*` tRPC surface on a process-owned root. The procedure and policy
 * are injected so the process's auth/audit/error/logging/tracing wrap every procedure.
 */
export class GroupTrpcApi {
  static create<
    TContext extends GroupTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: GroupTrpcProcedures<TContext, TOptions, TRoot>,
    ports: GroupTrpcPorts,
  ) {
    const { protected: procedure, policy, validateOutput } = procedures;

    return createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput,
    })
      .query("listAll", (p) =>
        p
          .withInput(organizationApiScopeSchema)
          .withOutput(groupListItemSchema.array())
          .withPermission(ORGANIZATION_MANAGE)
          .handle(async ({ ctx, input }) => {
            await ports.assertScimAllowed(ctx, { organizationId: input.organizationId });
            const page = await ctx.app.organizations.listGroups({
              organizationId: input.organizationId,
              ...GROUP_PAGE,
            });
            const allBindings = page.data.flatMap(({ bindings }) => bindings);
            const scopeNames = await ctx.app.organizations.resolveBindingScopeNames({
              organizationId: input.organizationId,
              bindings: allBindings,
            });
            return page.data.map((group) => ({
              id: group.id,
              name: group.name,
              slug: group.slug,
              externalId: group.externalId,
              scimSource: group.scimSource,
              memberCount: group.memberCount,
              bindings: group.bindings.map(withResolvedScopeName(scopeNames)),
              createdAt: group.createdAt,
            }));
          }),
      )
      .query("getById", (p) =>
        p
          .withInput(groupApiGroupScopeSchema)
          .withOutput(groupDetailSchema)
          .withPermission(ORGANIZATION_MANAGE)
          .handle(async ({ ctx, input }) => {
            const group = await ctx.app.organizations.getGroup(input);
            const scopeNames = await ctx.app.organizations.resolveBindingScopeNames({
              organizationId: input.organizationId,
              bindings: group.bindings,
            });
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
      )
      .mutation("create", (p) =>
        p
          .withInput(groupApiCreateInputSchema)
          .withOutput(organizationGroupSchema)
          .withPermission(ORGANIZATION_MANAGE)
          .handle(async ({ ctx, input }) => {
            await ports.assertScimAllowed(ctx, { organizationId: input.organizationId });
            return ctx.app.organizations.createGroup(input, ctx.actor());
          }),
      )
      .mutation("addBinding", (p) =>
        p
          .withInput(groupApiAddBindingInputSchema)
          .withOutput(groupBindingCreatedSchema)
          .withPermission(ORGANIZATION_MANAGE)
          .handle(async ({ ctx, input }) => {
            const { organizationId, groupId, ...binding } = input;
            const created = await ctx.app.organizations.addGroupBinding(
              { organizationId, groupId, binding },
              ctx.actor(),
            );
            return { id: created.id };
          }),
      )
      .mutation("removeBinding", (p) =>
        p
          .withInput(groupApiRemoveBindingInputSchema)
          .withOutput(groupWriteAckSchema)
          .withPermission(ORGANIZATION_MANAGE)
          .handle(async ({ ctx, input }) => {
            await ctx.app.organizations.removeGroupBinding(input, ctx.actor());
            return { success: true };
          }),
      )
      .mutation("addMember", (p) =>
        p
          .withInput(groupApiMemberInputSchema)
          .withOutput(groupWriteAckSchema)
          .withPermission(ORGANIZATION_MANAGE)
          .handle(async ({ ctx, input }) => {
            await ctx.app.organizations.addGroupMember(input);
            return { success: true };
          }),
      )
      .mutation("delete", (p) =>
        p
          .withInput(groupApiGroupScopeSchema)
          .withOutput(groupWriteAckSchema)
          .withPermission(ORGANIZATION_MANAGE)
          .handle(async ({ ctx, input }) => {
            await ctx.app.organizations.deleteGroup(
              { ...input, allowScimManaged: true },
              ctx.actor(),
            );
            return { success: true };
          }),
      )
      .mutation("rename", (p) =>
        p
          .withInput(groupApiRenameInputSchema)
          .withOutput(organizationGroupSchema)
          .withPermission(ORGANIZATION_MANAGE)
          .handle(({ ctx, input }) => ctx.app.organizations.renameGroup(input)),
      )
      .query("listForMember", (p) =>
        p
          .withInput(groupApiMemberScopeSchema)
          .withOutput(groupMembershipViewSchema.array())
          .withPermission(ORGANIZATION_MANAGE)
          .handle(async ({ ctx, input }) => {
            const groups = await ctx.app.organizations.listGroupsForMember(input);
            const allBindings = groups.flatMap(({ bindings }) => bindings);
            const scopeNames = await ctx.app.organizations.resolveBindingScopeNames({
              organizationId: input.organizationId,
              bindings: allBindings,
            });
            return groups.map((group) => ({
              id: group.id,
              name: group.name,
              scimSource: group.scimSource,
              bindings: group.bindings.map(toGroupMembershipBinding(scopeNames)),
            }));
          }),
      )
      .mutation("removeMember", (p) =>
        p
          .withInput(groupApiMemberInputSchema)
          .withOutput(groupWriteAckSchema)
          .withPermission(ORGANIZATION_MANAGE)
          .handle(async ({ ctx, input }) => {
            await ctx.app.organizations.removeGroupMember(input);
            return { success: true };
          }),
      )
      .mutation("applyEdits", (p) =>
        p
          .withInput(groupApiApplyEditsInputSchema)
          .withOutput(groupWriteAckSchema)
          .withPermission(ORGANIZATION_MANAGE)
          .handle(async ({ ctx, input }) => {
            await ctx.app.organizations.applyGroupEdits(input, ctx.actor());
            return { success: true };
          }),
      )
      .build();
  }
}
