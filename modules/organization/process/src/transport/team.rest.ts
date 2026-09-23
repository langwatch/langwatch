import { SYSTEM_ACTORS } from "@langwatch/actor";
import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  type RestTransportDeclaration,
} from "@langwatch/api/rest";
import type { AuthzApi, AuthzTeamMemberBinding } from "@langwatch/authz-contract";
import { moduleApi } from "@langwatch/kernel/module-api";
/**
 * `/api/teams` - the organization's teams, their members, and their projects.
 * Routes that address a single team (`:id`) check permissions at team scope;
 * collection routes stay at organization scope as they operate on that whole set.
 */
import {
  type organizationTeamRestMemberSchema,
  organizationTeamRestAddMemberSchema,
  organizationTeamRestArchivedSchema,
  organizationTeamRestCreateSchema,
  organizationTeamRestMemberListSchema,
  organizationTeamRestMemberParamsSchema,
  organizationTeamRestPageSchema,
  organizationTeamRestPaginationQuerySchema,
  organizationTeamRestParamsSchema,
  organizationTeamRestProjectListSchema,
  organizationTeamRestSchema,
  organizationTeamRestSuccessSchema,
  organizationTeamRestUpdateSchema,
  type OrganizationApi,
  type OrganizationCaller,
  type OrganizationTeam,
  type UpdateOrganizationTeamInput,
} from "@langwatch/organization-contract";
import type { z } from "zod";

/**
 * What the `/api/teams` family reaches, as flat operations the organization's
 * own application serves — taken off {@link OrganizationApi}/{@link AuthzApi}
 * to avoid drift; `updateTeam` alone is `OrganizationService`'s, off the peer contract.
 */
export interface TeamManagementApi
  extends
    Pick<
      OrganizationApi,
      | "listTeams"
      | "createTeam"
      | "getTeam"
      | "archiveTeam"
      | "addTeamMember"
      | "removeTeamMember"
      | "listProjectsByTeam"
    >,
    Pick<AuthzApi, "listTeamMemberBindings"> {
  /**
   * Renames one of this organization's teams. The body carries a name or
   * nothing at all, and nothing else: a PATCH here never touches membership,
   * which is what `updateTeamWithMembers` is for and why it is not this.
   */
  updateTeam(input: UpdateOrganizationTeamInput): Promise<OrganizationTeam>;
}

export const TeamManagementApi = moduleApi<TeamManagementApi>()("organization");

/**
 * Who a write is attributed to: the member the credential acts as, or the
 * management API itself for a service key, which acts as nobody.
 */
const callerOf = (actor: { type: string; id?: string } | null): OrganizationCaller =>
  actor && actor.type === "user" && actor.id
    ? { id: actor.id }
    : { id: SYSTEM_ACTORS.managementApi };

/**
 * The team's response shape: the stored shape omits the personal flag and owner,
 * so the wire is narrower.
 */
function teamResponse(team: OrganizationTeam): {
  id: string;
  name: string;
  slug: string;
  organizationId: string;
  createdAt: Date;
  updatedAt: Date;
} {
  return {
    id: team.id,
    name: team.name,
    slug: team.slug,
    organizationId: team.organizationId,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
  };
}

/**
 * A team member with the role their binding grants at the team's scope,
 * converted from the authz service's binding shape to the wire shape.
 */
function memberResponse(
  binding: AuthzTeamMemberBinding,
): z.infer<typeof organizationTeamRestMemberSchema> {
  return {
    userId: binding.userId,
    name: binding.user?.name ?? null,
    email: binding.user?.email ?? null,
    role: binding.role,
  };
}

/**
 * The `/api/teams` family, and its `/api/v1/teams` canonical twin. The type is
 * written out rather than inferred so the declaration emit stays portable.
 */
export const teamsRest: Readonly<{
  protocol: "rest";
  namespace: string;
  router: () => RestTransportDeclaration<TeamManagementApi>;
}> = defineRestRouter(TeamManagementApi)
  .withNamespace("teams")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("organization")

  .get("/", "listTeams")
  .withPermission("team:view")
  .withQuery(organizationTeamRestPaginationQuerySchema)
  .withOutput(organizationTeamRestPageSchema)
  .withDocs({
    tags: ["Teams"],
    description: "List all non-archived teams for the organization (paginated)",
  })
  .handle(async ({ app, input, scope }) => {
    const result = await app.listTeams({
      organizationId: scope.id,
      page: input.page,
      limit: input.limit,
    });

    return {
      data: result.data.map(teamResponse),
      pagination: result.pagination,
    };
  })

  .post("/", "createTeam")
  .withPermission("team:manage")
  .withInput(organizationTeamRestCreateSchema)
  .withOutput(organizationTeamRestSchema)
  .withStatus(201)
  .withDocs({
    tags: ["Teams"],
    description: "Create a new team that can group projects and members",
  })
  .handle(async ({ app, input, scope }) =>
    teamResponse(
      await app.createTeam({
        organizationId: scope.id,
        name: input.name,
      }),
    ),
  )

  .get("/:teamId", "getTeam")
  .withPermission("team:view")
  .withParams(organizationTeamRestParamsSchema)
  .withOutput(organizationTeamRestSchema)
  .withDocs({
    tags: ["Teams"],
    description: "Get a team by its id",
  })
  .handle(async ({ app, input, scope }) =>
    teamResponse(
      await app.getTeam({
        teamId: input.teamId,
        organizationId: scope.id,
      }),
    ),
  )

  .patch("/:teamId", "updateTeam")
  .withPermission("team:manage")
  .withParams(organizationTeamRestParamsSchema)
  .withInput(organizationTeamRestUpdateSchema)
  .withOutput(organizationTeamRestSchema)
  .withDocs({
    tags: ["Teams"],
    description: "Update a team by its id",
  })
  .handle(async ({ app, input, scope }) =>
    teamResponse(
      await app.updateTeam({
        teamId: input.teamId,
        organizationId: scope.id,
        ...(input.name === undefined ? {} : { name: input.name }),
      }),
    ),
  )

  .delete("/:teamId", "archiveTeam")
  .withPermission("team:manage")
  .withParams(organizationTeamRestParamsSchema)
  .withOutput(organizationTeamRestArchivedSchema)
  .withDocs({
    tags: ["Teams"],
    description: "Archive a team (soft-delete)",
  })
  .handle(async ({ app, input, scope }) => {
    const team = await app.archiveTeam({
      teamId: input.teamId,
      organizationId: scope.id,
    });

    return {
      id: team.id,
      name: team.name,
      archivedAt: team.archivedAt ?? null,
    };
  })

  .get("/:teamId/members", "listTeamMembers")
  .withPermission("team:view")
  .withParams(organizationTeamRestParamsSchema)
  .withOutput(organizationTeamRestMemberListSchema)
  .withDocs({
    tags: ["Teams"],
    description: "List members of a team",
  })
  .handle(async ({ app, input, scope }) => {
    // Reads the team first so a team outside the organization is a 404 rather
    // than an empty membership list.
    await app.getTeam({
      teamId: input.teamId,
      organizationId: scope.id,
    });

    const bindings = await app.listTeamMemberBindings({
      organizationId: scope.id,
      teamIds: [input.teamId],
    });

    return {
      data: (bindings.get(input.teamId) ?? []).map(memberResponse),
    };
  })

  .post("/:teamId/members", "addTeamMember")
  .withPermission("team:manage")
  .withParams(organizationTeamRestParamsSchema)
  .withInput(organizationTeamRestAddMemberSchema)
  .withOutput(organizationTeamRestSuccessSchema)
  .withStatus(201)
  .withDocs({
    tags: ["Teams"],
    description: "Add a member to a team",
  })
  .handle(async ({ app, input, scope, actor }) => {
    const ledgerActor =
      actor && actor.type === "user"
        ? { type: "user" as const, id: actor.id ?? null }
        : { type: "system" as const, id: null };

    await app.addTeamMember({
      teamId: input.teamId,
      organizationId: scope.id,
      userId: input.userId,
      role: input.role,
      actor: ledgerActor,
    });

    return { success: true };
  })

  .delete("/:teamId/members/:userId", "removeTeamMember")
  .withPermission("team:manage")
  .withParams(organizationTeamRestMemberParamsSchema)
  .withOutput(organizationTeamRestSuccessSchema)
  .withDocs({
    tags: ["Teams"],
    description: "Remove a member from a team",
  })
  .handle(async ({ app, input, scope, actor }) => {
    await app.removeTeamMember(
      {
        teamId: input.teamId,
        organizationId: scope.id,
        userId: input.userId,
      },
      callerOf(actor),
    );

    return { success: true };
  })

  .get("/:teamId/projects", "listTeamProjects")
  .withPermission("team:view")
  .withParams(organizationTeamRestParamsSchema)
  .withOutput(organizationTeamRestProjectListSchema)
  .withDocs({
    tags: ["Teams"],
    description: "List projects in a team",
  })
  .handle(async ({ app, input, scope }) => {
    await app.getTeam({
      teamId: input.teamId,
      organizationId: scope.id,
    });

    return {
      data: await app.listProjectsByTeam({
        organizationId: scope.id,
        teamId: input.teamId,
      }),
    };
  })

  .build();
