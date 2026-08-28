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
 * Transport only: gates, plan enforcement, name resolution for display, and
 * delegation to `OrganizationService` and the composed `ProjectService`.
 *
 * Spec: packages/features/organization/specs/organization-service.feature.
 */
import type { LedgerActor } from "@langwatch/actor";
import type { AuthzDeclaration } from "@langwatch/authz-contract";
import {
  organizationGroupBindingInputSchema,
  type OrganizationGroupBinding,
  type OrganizationService,
} from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type {
  AnyTRPCRootTypes,
  TRPCRootObject,
  TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";

/**
 * The thirteen reads and writes this transport makes, named rather than taking
 * `OrganizationService` whole: the organization service is the widest surface
 * in the platform, and a group screen has no business depending on the parts
 * of it that answer billing seats, invites or settings.
 */
type GroupOrganizationService = Pick<
  OrganizationService,
  | "getBillingProfile"
  | "getTeam"
  | "listGroups"
  | "getGroup"
  | "listGroupsForMember"
  | "createGroup"
  | "renameGroup"
  | "deleteGroup"
  | "addGroupMember"
  | "removeGroupMember"
  | "addGroupBinding"
  | "removeGroupBinding"
  | "applyGroupEdits"
>;

/** The one project read a group screen makes: the name behind a binding. */
type GroupProjectService = Pick<ProjectService, "tryGetById">;

type GroupApplication = Readonly<{
  organizations: GroupOrganizationService;
  projects: GroupProjectService;
}>;

/** The process supplies authentication; authorization arrives as `policy`. */
export type GroupTrpcContext = Readonly<{
  app: GroupApplication;
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

const groupNameSchema = z.string().trim().min(1, "Group name is required").max(100);

const organizationScopeSchema = z.object({ organizationId: z.string() });

const groupScopeSchema = z.object({
  organizationId: z.string(),
  groupId: z.string(),
});

const createInputSchema = z.object({
  organizationId: z.string(),
  name: groupNameSchema,
  bindings: z.array(organizationGroupBindingInputSchema).optional(),
  memberIds: z.array(z.string()).optional(),
});

const addBindingInputSchema = z.object({
  organizationId: z.string(),
  groupId: z.string(),
  ...organizationGroupBindingInputSchema.shape,
});

const removeBindingInputSchema = z.object({
  organizationId: z.string(),
  bindingId: z.string(),
});

const groupMemberInputSchema = z.object({
  organizationId: z.string(),
  groupId: z.string(),
  userId: z.string(),
});

const renameInputSchema = z.object({
  organizationId: z.string(),
  groupId: z.string(),
  name: groupNameSchema,
});

const memberScopeSchema = z.object({
  organizationId: z.string(),
  userId: z.string(),
});

const applyEditsInputSchema = z.object({
  organizationId: z.string(),
  groupId: z.string(),
  rename: z.object({ name: groupNameSchema }).nullable().optional(),
  bindingIdsToDelete: z.array(z.string()),
  bindingsToCreate: z.array(organizationGroupBindingInputSchema),
  memberUserIdsToAdd: z.array(z.string()),
  memberUserIdsToRemove: z.array(z.string()),
});

const ledgerActor = (userId: string): LedgerActor => ({ type: "user", id: userId });

/**
 * The display name behind each binding's scope id, one lookup per distinct
 * scope rather than one per binding — a group bound to the same team through
 * several roles would otherwise read the team once for each.
 */
async function resolveScopeNames(
  app: GroupApplication,
  organizationId: string,
  bindings: readonly OrganizationGroupBinding[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const uniqueBindings = [
    ...new Map(bindings.map((binding) => [binding.scopeId, binding])).values(),
  ];
  await Promise.all(
    uniqueBindings.map(async (binding) => {
      if (binding.scopeType === "ORGANIZATION") {
        const organization = await app.organizations.getBillingProfile({ organizationId });
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
      listAll: policy(ORGANIZATION_MANAGE)(procedure.input(organizationScopeSchema)).query(
        async ({ ctx, input }) => {
          await ports.assertScimAllowed(ctx, { organizationId: input.organizationId });
          const page = await ctx.app.organizations.listGroups({
            organizationId: input.organizationId,
            ...GROUP_PAGE,
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
        },
      ),

      getById: policy(ORGANIZATION_MANAGE)(procedure.input(groupScopeSchema)).query(
        async ({ ctx, input }) => {
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
        },
      ),

      create: policy(ORGANIZATION_MANAGE)(procedure.input(createInputSchema)).mutation(
        async ({ ctx, input }) => {
          await ports.assertScimAllowed(ctx, { organizationId: input.organizationId });
          return ctx.app.organizations.createGroup({
            ...input,
            actor: ledgerActor(ctx.actor().id),
          });
        },
      ),

      addBinding: policy(ORGANIZATION_MANAGE)(procedure.input(addBindingInputSchema)).mutation(
        async ({ ctx, input }) => {
          const { organizationId, groupId, ...binding } = input;
          const created = await ctx.app.organizations.addGroupBinding({
            organizationId,
            groupId,
            binding,
            actor: ledgerActor(ctx.actor().id),
          });
          return { id: created.id };
        },
      ),

      removeBinding: policy(ORGANIZATION_MANAGE)(
        procedure.input(removeBindingInputSchema),
      ).mutation(async ({ ctx, input }) => {
        await ctx.app.organizations.removeGroupBinding({
          ...input,
          actor: ledgerActor(ctx.actor().id),
        });
        return { success: true };
      }),

      addMember: policy(ORGANIZATION_MANAGE)(procedure.input(groupMemberInputSchema)).mutation(
        async ({ ctx, input }) => {
          await ctx.app.organizations.addGroupMember(input);
          return { success: true };
        },
      ),

      delete: policy(ORGANIZATION_MANAGE)(procedure.input(groupScopeSchema)).mutation(
        async ({ ctx, input }) => {
          await ctx.app.organizations.deleteGroup({
            ...input,
            actor: ledgerActor(ctx.actor().id),
            allowScimManaged: true,
          });
          return { success: true };
        },
      ),

      rename: policy(ORGANIZATION_MANAGE)(procedure.input(renameInputSchema)).mutation(
        ({ ctx, input }) => ctx.app.organizations.renameGroup(input),
      ),

      listForMember: policy(ORGANIZATION_MANAGE)(procedure.input(memberScopeSchema)).query(
        async ({ ctx, input }) => {
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
        },
      ),

      removeMember: policy(ORGANIZATION_MANAGE)(
        procedure.input(groupMemberInputSchema),
      ).mutation(async ({ ctx, input }) => {
        await ctx.app.organizations.removeGroupMember(input);
        return { success: true };
      }),

      applyEdits: policy(ORGANIZATION_MANAGE)(procedure.input(applyEditsInputSchema)).mutation(
        async ({ ctx, input }) => {
          await ctx.app.organizations.applyGroupEdits({
            ...input,
            actor: ledgerActor(ctx.actor().id),
          });
          return { success: true };
        },
      ),
    });
  }
}
