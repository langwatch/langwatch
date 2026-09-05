/**
 * A team over the process's tRPC transport. A team belongs to exactly one
 * organization, which is why it is the organization feature that owns this
 * surface (`packages/features/catalogue.json` lists `team` among the
 * organization's subjects).
 *
 *   getBySlug:                the team behind a `/[team]` route, resolved for
 *                             the caller as a member of it.
 *   getTeamsWithMembers:      the organization's teams, each with its members
 *                             and the projects that live in it.
 *   getTeamsWithRoleBindings: the access matrix the team-permissions admin
 *                             screen renders.
 *   getTeamWithMembers:       one team's members plus its projects.
 *   update:                   saves the team settings form — name and the
 *                             whole member list in one diff.
 *   createTeamWithMembers:    creates a team with its initial members.
 *   archiveById:              archives a team.
 *   removeMember:             removes one member from a team.
 *
 * Reading takes `organization:view`, which every member holds, and the member
 * lists are filtered by the service against what the caller may actually see.
 * Administering a team takes `team:manage`; creating one, or reading the
 * organization-wide access matrix, takes `organization:manage`.
 *
 * Transport only: gates, plan enforcement, and delegation to
 * {@link OrganizationApp}, which is where the organization service, the
 * composed project service and the ledger attribution now arrive from. Custom
 * team roles are an Enterprise capability, and the plan lives in the process's
 * billing store, so that refusal arrives as a port.
 *
 * Spec: packages/features/organization/specs/organization-service.feature.
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
import type { OrganizationApp } from "#app/organization.app";

/**
 * The process supplies authentication; authorization arrives as `policy`.
 *
 * `app` is the slice of the process's application this feature reaches, not
 * the feature's application itself, because a tRPC root is shared by every
 * feature mounted on it and so carries all of them. Before
 * {@link OrganizationApp} this door declared its own `TeamApplication` — nine
 * organization methods and two project ones — which is why it could not reach
 * the group screen's copy of the same composition.
 */
export type TeamTrpcContext = Readonly<{
  app: Readonly<{ organizations: OrganizationApp }>;
  actor(): Readonly<{ id: string }>;
}>;

type TeamTrpcProcedures<
  TContext extends TeamTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's tracing, logging, error, scope-lineage, authorization and
   * audit policy for one declared permission.
   *
   * Applied by this feature AFTER its own input parser rather than composed
   * ahead of it, because the authorization check reads its scope id from the
   * validated input: tRPC runs middlewares in the order they were added, so a
   * check installed before `.input()` would see no input at all.
   */
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
 * Installs the complete `team.*` tRPC surface on a process-owned root. The
 * procedure and the policy are injected by the process so its auth, audit,
 * error, logging and tracing policies wrap every feature procedure
 * consistently.
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
