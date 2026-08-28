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
 * `OrganizationService` and the composed `ProjectService`. Custom team roles
 * are an Enterprise capability, and the plan lives in the process's billing
 * store, so that refusal arrives as a port.
 *
 * Spec: packages/features/organization/specs/organization-service.feature.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  organizationApiScopeSchema,
  teamApiCreateWithMembersInputSchema,
  teamApiRemoveMemberInputSchema,
  teamApiSlugSchema,
  teamApiSlugWithOrganizationSchema,
  teamApiTeamScopeSchema,
  teamApiUpdateInputSchema,
  type OrganizationService,
} from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";
import {
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";

/**
 * The nine reads and writes this transport makes, named rather than taking
 * `OrganizationService` whole: the organization service is the widest surface
 * in the platform, and a team screen has no business depending on the parts of
 * it that answer billing, invites, groups or settings.
 */
type TeamOrganizationService = Pick<
  OrganizationService,
  | "getTeamBySlugForMember"
  | "getTeamWithMembers"
  | "listTeamsWithMembers"
  | "listTeamAccess"
  | "getTeamById"
  | "createTeamWithMembers"
  | "updateTeamWithMembers"
  | "archiveTeam"
  | "removeTeamMember"
>;

/** The two project reads a team screen makes: what lives in the team. */
type TeamProjectService = Pick<ProjectService, "listByOrganization" | "listByTeam">;

type TeamApplication = Readonly<{
  organizations: TeamOrganizationService;
  projects: TeamProjectService;
}>;

/** The process supplies authentication; authorization arrives as `policy`. */
export type TeamTrpcContext = Readonly<{
  app: TeamApplication;
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
}>;

/**
 * The process capabilities this transport needs that are not the
 * organization's own.
 */
type TeamTrpcPorts = Readonly<{
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
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      getBySlug: policy("organization:view")(procedure.input(teamApiSlugSchema)).query(
        ({ input, ctx }) =>
          ctx.app.organizations.getTeamBySlugForMember({
            ...input,
            userId: ctx.actor().id,
          }),
      ),

      getTeamsWithMembers: policy("organization:view")(
        procedure.input(organizationApiScopeSchema),
      ).query(async ({ input, ctx }) => {
        const callerCanManage = await ports.probeOrganizationPermission(
          ctx,
          input.organizationId,
          "organization:manage",
        );
        const [teams, projects] = await Promise.all([
          ctx.app.organizations.listTeamsWithMembers({
            organizationId: input.organizationId,
            callerUserId: ctx.actor().id,
            callerCanManage,
          }),
          ctx.app.projects.listByOrganization({
            organizationId: input.organizationId,
            ...ORGANIZATION_PROJECT_PAGE,
          }),
        ]);
        return teams.map((team) => ({
          ...team,
          projects: projects.data.filter(({ teamId }) => teamId === team.id),
        }));
      }),

      getTeamsWithRoleBindings: policy("organization:manage")(
        procedure.input(organizationApiScopeSchema),
      ).query(async ({ input, ctx }) => {
        const projects = await ctx.app.projects.listByOrganization({
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

      getTeamWithMembers: policy("organization:view")(
        procedure.input(teamApiSlugWithOrganizationSchema),
      ).query(async ({ input, ctx }) => {
        const callerCanManage = await ports.probeOrganizationPermission(
          ctx,
          input.organizationId,
          "organization:manage",
        );
        const team = await ctx.app.organizations.getTeamWithMembers({
          ...input,
          callerUserId: ctx.actor().id,
          callerCanManage,
        });
        const projects = await ctx.app.projects.listByTeam({
          organizationId: input.organizationId,
          teamId: team.id,
        });
        return { ...team, projects };
      }),

      update: policy("team:manage")(procedure.input(teamApiUpdateInputSchema)).mutation(
        async ({ input, ctx }) => {
          const team = await ctx.app.organizations.getTeamById({
            teamId: input.teamId,
          });
          await ports.assertCustomRolesAllowed(ctx, {
            organizationId: team.organizationId,
            members: input.members,
          });
          await ctx.app.organizations.updateTeamWithMembers({
            ...input,
            actor: { type: "user", id: ctx.actor().id },
          });
          return { success: true as const };
        },
      ),

      createTeamWithMembers: policy("organization:manage")(
        procedure.input(teamApiCreateWithMembersInputSchema),
      ).mutation(async ({ input, ctx }) => {
        await ports.assertCustomRolesAllowed(ctx, {
          organizationId: input.organizationId,
          members: input.members,
        });
        return ctx.app.organizations.createTeamWithMembers({
          ...input,
          actor: { type: "user", id: ctx.actor().id },
        });
      }),

      archiveById: policy("team:manage")(procedure.input(teamApiTeamScopeSchema)).mutation(
        async ({ input, ctx }) => {
          const team = await ctx.app.organizations.getTeamById(input);
          await ctx.app.organizations.archiveTeam({
            teamId: team.id,
            organizationId: team.organizationId,
          });
          return { success: true as const };
        },
      ),

      removeMember: policy("team:manage")(procedure.input(teamApiRemoveMemberInputSchema)).mutation(
        async ({ input, ctx }) => {
          const team = await ctx.app.organizations.getTeamById({
            teamId: input.teamId,
          });
          await ctx.app.organizations.removeTeamMember({
            ...input,
            organizationId: team.organizationId,
            actor: { type: "user", id: ctx.actor().id },
          });
          return { success: true as const, removedUserId: input.userId };
        },
      ),
    });
  }
}
