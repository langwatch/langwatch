/**
 * A team over the process's tRPC transport, owned by the organization feature since a team
 * belongs to one organization. `organization:view` reads (filtered by the service); `team:manage`
 * administers; `organization:manage` creates or reads the access matrix. Transport only.
 */
import { createTrpcService } from "@langwatch/api/trpc";
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  organizationApiScopeSchema,
  organizationTeamAccessSchema,
  organizationTeamSchema,
  teamApiCreateWithMembersInputSchema,
  teamApiRemoveMemberInputSchema,
  teamApiSlugSchema,
  teamApiSlugWithOrganizationSchema,
  teamApiTeamScopeSchema,
  teamApiUpdateInputSchema,
  teamMemberRemovedSchema,
  teamWithProjectsSchema,
  teamWriteAckSchema,
} from "@langwatch/organization-contract";
import {
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import type { OrganizationApi } from "@langwatch/organization-contract";

/**
 * The process supplies authentication; authorization arrives as `policy`. `app` is the slice of
 * the process's application this feature reaches, since a shared tRPC root carries every feature.
 */
export type TeamTrpcContext = Readonly<{
  app: Readonly<{ organizations: OrganizationApi }>;
  actor(): Readonly<{ id: string }>;
}>;

type TeamTrpcProcedures<
  TContext extends TeamTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /** The process's tracing/logging/error/scope-lineage/authorization/audit policy for one
   * permission. Applied after this feature's own input parser, since the check reads its
   * scope id from the validated input. */
  policy(permission: AuthzPermission): <TProcedure>(procedure: TProcedure) => TProcedure;
  /** @see the mount field of the same name. */
  validateOutput: boolean;
}>;

/**
 * The process capabilities this transport needs that are not the
 * organization's own.
 */
export type TeamTrpcPorts = Readonly<{
  /**
   * Whether the caller may administer the organization. Not a gate: the two
   * member reads pass it to the service, which widens or narrows what each
   * member row shows. A caller who cannot manage still gets the team.
   */
  probeOrganizationPermission(
    ctx: TeamTrpcContext,
    organizationId: string,
    permission: AuthzPermission,
  ): Promise<boolean>;
  /**
   * Refuses a member list that assigns a custom role when the organization's
   * plan is not Enterprise. Throws; a refusal is never turned into a
   * different answer here.
   */
  assertCustomRolesAllowed(
    ctx: TeamTrpcContext,
    input: Readonly<{
      organizationId: string;
      members: readonly Readonly<{ role: string }>[];
    }>,
  ): Promise<void>;
}>;

/** The page size the two project lookups read the organization at. */
const ORGANIZATION_PROJECT_PAGE = { page: 1, limit: 1_000 } as const;

/** The projects belonging to one team, out of a page already keyed by teamId. */
function projectsForTeam<T extends Readonly<{ teamId: string }>>(
  projects: readonly T[],
  teamId: string,
): T[] {
  return projects.filter((project) => project.teamId === teamId);
}

/**
 * Installs the complete `team.*` tRPC surface on a process-owned root. Procedure and policy are
 * injected so the process's auth/audit/error/logging/tracing wrap every procedure.
 */
export class TeamTrpcApi {
  static create<
    TContext extends TeamTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: TeamTrpcProcedures<TContext, TOptions, TRoot>,
    ports: TeamTrpcPorts,
  ) {
    const { protected: procedure, policy, validateOutput } = procedures;

    return createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput,
    })
      .query("getBySlug", (p) =>
        p
          .withInput(teamApiSlugSchema)
          .withOutput(organizationTeamSchema)
          .withPermission("organization:view")
          .handle(({ input, ctx }) =>
            ctx.app.organizations.getTeamBySlugForMember(input, ctx.actor()),
          ),
      )
      .query("getTeamsWithMembers", (p) =>
        p
          .withInput(organizationApiScopeSchema)
          .withOutput(teamWithProjectsSchema.array())
          .withPermission("organization:view")
          .handle(async ({ input, ctx }) => {
            const callerCanManage = await ports.probeOrganizationPermission(
              ctx,
              input.organizationId,
              "organization:manage",
            );
            const [teams, projects] = await Promise.all([
              ctx.app.organizations.listTeamsWithMembers(
                { organizationId: input.organizationId, callerCanManage },
                ctx.actor(),
              ),
              ctx.app.organizations.listProjectsByOrganization({
                organizationId: input.organizationId,
                ...ORGANIZATION_PROJECT_PAGE,
              }),
            ]);
            return teams.map((team) => ({
              ...team,
              projects: projectsForTeam(projects.data, team.id),
            }));
          }),
      )
      .query("getTeamsWithRoleBindings", (p) =>
        p
          .withInput(organizationApiScopeSchema)
          .withOutput(organizationTeamAccessSchema.array())
          .withPermission("organization:manage")
          .handle(async ({ input, ctx }) => {
            const projects = await ctx.app.organizations.listProjectsByOrganization({
              organizationId: input.organizationId,
              ...ORGANIZATION_PROJECT_PAGE,
            });
            return ctx.app.organizations.listTeamAccess({
              organizationId: input.organizationId,
              projects: projects.data.map(({ id, name, teamId }) => ({
                id,
                name,
                teamId,
              })),
            });
          }),
      )
      .query("getTeamWithMembers", (p) =>
        p
          .withInput(teamApiSlugWithOrganizationSchema)
          .withOutput(teamWithProjectsSchema)
          .withPermission("organization:view")
          .handle(async ({ input, ctx }) => {
            const callerCanManage = await ports.probeOrganizationPermission(
              ctx,
              input.organizationId,
              "organization:manage",
            );
            const team = await ctx.app.organizations.getTeamWithMembers(
              { ...input, callerCanManage },
              ctx.actor(),
            );
            const projects = await ctx.app.organizations.listProjectsByTeam({
              organizationId: input.organizationId,
              teamId: team.id,
            });
            return { ...team, projects };
          }),
      )
      .mutation("update", (p) =>
        p
          .withInput(teamApiUpdateInputSchema)
          .withOutput(teamWriteAckSchema)
          .withPermission("team:manage")
          .handle(async ({ input, ctx }) => {
            const team = await ctx.app.organizations.getTeamById({
              teamId: input.teamId,
            });
            await ports.assertCustomRolesAllowed(ctx, {
              organizationId: team.organizationId,
              members: input.members,
            });
            await ctx.app.organizations.updateTeamWithMembers(input, ctx.actor());
            return { success: true as const };
          }),
      )
      .mutation("createTeamWithMembers", (p) =>
        p
          .withInput(teamApiCreateWithMembersInputSchema)
          .withOutput(organizationTeamSchema)
          .withPermission("organization:manage")
          .handle(async ({ input, ctx }) => {
            await ports.assertCustomRolesAllowed(ctx, {
              organizationId: input.organizationId,
              members: input.members,
            });
            return ctx.app.organizations.createTeamWithMembers(input, ctx.actor());
          }),
      )
      .mutation("archiveById", (p) =>
        p
          .withInput(teamApiTeamScopeSchema)
          .withOutput(teamWriteAckSchema)
          .withPermission("team:manage")
          .handle(async ({ input, ctx }) => {
            const team = await ctx.app.organizations.getTeamById(input);
            await ctx.app.organizations.archiveTeam({
              teamId: team.id,
              organizationId: team.organizationId,
            });
            return { success: true as const };
          }),
      )
      .mutation("removeMember", (p) =>
        p
          .withInput(teamApiRemoveMemberInputSchema)
          .withOutput(teamMemberRemovedSchema)
          .withPermission("team:manage")
          .handle(async ({ input, ctx }) => {
            const team = await ctx.app.organizations.getTeamById({
              teamId: input.teamId,
            });
            await ctx.app.organizations.removeTeamMember(
              { ...input, organizationId: team.organizationId },
              ctx.actor(),
            );
            return { success: true as const, removedUserId: input.userId };
          }),
      )
      .build();
  }
}
