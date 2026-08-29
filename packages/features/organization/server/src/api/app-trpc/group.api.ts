/**
 * A group over the process's tRPC transport. A group belongs to exactly one
 * organization, which is why it is the organization feature that owns this
 * surface (`packages/features/catalogue.json` lists `group` among the
 * organization's subjects).
 *
 *   listAll:       every group in the organization, each with its access
 *                  bindings resolved to the names an admin reads.
 *   getById:       one group, with its bindings and its members.
 *   create:        a new group, optionally with bindings and members.
 *   rename:        renames one.
 *   delete:        removes one, SCIM-managed groups included.
 *   addBinding /
 *   removeBinding: one access binding at a time, for the row-level controls.
 *   addMember /
 *   removeMember:  one membership at a time.
 *   listForMember: the groups one member is in, for the member drawer.
 *   applyEdits:    the group editor's whole diff — rename, bindings added and
 *                  removed, members added and removed — in one call.
 *
 * Every procedure takes `organization:manage`. A group IS an access grant:
 * reading the list tells you who can reach what, and every write here hands
 * out or takes away access across teams and projects.
 *
 * Groups arrive with SCIM, so creating one and listing them are gated on the
 * Enterprise plan. The plan lives in the process's billing store, so that
 * refusal arrives as a port.
 *
 * Transport only: gates, plan enforcement, and delegation to
 * {@link OrganizationApp} — which is where the organization service, the
 * composed project service, the ledger attribution and the binding-scope name
 * resolution now arrive from.
 *
 * Spec: packages/features/organization/specs/organization-service.feature.
 */
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
  organizationApiScopeSchema,
} from "@langwatch/organization-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import type { OrganizationApp } from "#app/organization.app";

/**
 * The process supplies authentication; authorization arrives as `policy`.
 *
 * `app` is the slice of the process's application this feature reaches, not
 * the feature's application itself, because a tRPC root is shared by every
 * feature mounted on it and so carries all of them. Before
 * {@link OrganizationApp} this door declared its own `GroupApplication` —
 * thirteen organization methods and one project one — which is why it could
 * not reach the team screen's copy of the same composition.
 */
export type GroupTrpcContext = Readonly<{
  app: Readonly<{ organizations: OrganizationApp }>;
  actor(): Readonly<{ id: string }>;
}>;

type GroupTrpcProcedures<
  TContext extends GroupTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's tracing, logging, error, scope-lineage, authorization and
   * audit policy for one access declaration.
   *
   * Applied by this feature AFTER its own input parser rather than composed
   * ahead of it, because the authorization check reads its scope id from the
   * validated input: tRPC runs middlewares in the order they were added, so a
   * check installed before `.input()` would see no input at all.
   */
  policy(declaration: AuthzDeclaration): <TProcedure>(procedure: TProcedure) => TProcedure;
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

/**
 * Installs the complete `group.*` tRPC surface on a process-owned root. The
 * procedure and the policy are injected by the process so its auth, audit,
 * error, logging and tracing policies wrap every feature procedure
 * consistently.
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
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      listAll: policy(ORGANIZATION_MANAGE)(procedure.input(organizationApiScopeSchema)).query(
        async ({ ctx, input }) => {
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
            bindings: group.bindings.map((binding) => ({
              ...binding,
              scopeName: scopeNames.get(binding.scopeId) ?? null,
            })),
            createdAt: group.createdAt,
          }));
        },
      ),

      getById: policy(ORGANIZATION_MANAGE)(procedure.input(groupApiGroupScopeSchema)).query(
        async ({ ctx, input }) => {
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
        },
      ),

      create: policy(ORGANIZATION_MANAGE)(procedure.input(groupApiCreateInputSchema)).mutation(
        async ({ ctx, input }) => {
          await ports.assertScimAllowed(ctx, { organizationId: input.organizationId });
          return ctx.app.organizations.createGroup(input, ctx.actor());
        },
      ),

      addBinding: policy(ORGANIZATION_MANAGE)(
        procedure.input(groupApiAddBindingInputSchema),
      ).mutation(async ({ ctx, input }) => {
        const { organizationId, groupId, ...binding } = input;
        const created = await ctx.app.organizations.addGroupBinding(
          { organizationId, groupId, binding },
          ctx.actor(),
        );
        return { id: created.id };
      }),

      removeBinding: policy(ORGANIZATION_MANAGE)(
        procedure.input(groupApiRemoveBindingInputSchema),
      ).mutation(async ({ ctx, input }) => {
        await ctx.app.organizations.removeGroupBinding(input, ctx.actor());
        return { success: true };
      }),

      addMember: policy(ORGANIZATION_MANAGE)(procedure.input(groupApiMemberInputSchema)).mutation(
        async ({ ctx, input }) => {
          await ctx.app.organizations.addGroupMember(input);
          return { success: true };
        },
      ),

      delete: policy(ORGANIZATION_MANAGE)(procedure.input(groupApiGroupScopeSchema)).mutation(
        async ({ ctx, input }) => {
          await ctx.app.organizations.deleteGroup(
            { ...input, allowScimManaged: true },
            ctx.actor(),
          );
          return { success: true };
        },
      ),

      rename: policy(ORGANIZATION_MANAGE)(procedure.input(groupApiRenameInputSchema)).mutation(
        ({ ctx, input }) => ctx.app.organizations.renameGroup(input),
      ),

      listForMember: policy(ORGANIZATION_MANAGE)(procedure.input(groupApiMemberScopeSchema)).query(
        async ({ ctx, input }) => {
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
            bindings: group.bindings.map((binding) => ({
              id: binding.id,
              role: binding.role,
              customRoleName: binding.customRoleName,
              scopeType: binding.scopeType,
              scopeName: scopeNames.get(binding.scopeId) ?? binding.scopeId,
            })),
          }));
        },
      ),

      removeMember: policy(ORGANIZATION_MANAGE)(
        procedure.input(groupApiMemberInputSchema),
      ).mutation(async ({ ctx, input }) => {
        await ctx.app.organizations.removeGroupMember(input);
        return { success: true };
      }),

      applyEdits: policy(ORGANIZATION_MANAGE)(
        procedure.input(groupApiApplyEditsInputSchema),
      ).mutation(async ({ ctx, input }) => {
        await ctx.app.organizations.applyGroupEdits(input, ctx.actor());
        return { success: true };
      }),
    });
  }
}
