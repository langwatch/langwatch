/**
 * `/api/teams` - the organization's teams, their members, and their projects.
 * Routes that address a single team (`:id`) check permissions at team scope;
 * collection routes stay at organization scope as they operate on that whole set.
 */
import {
  organizationTeamRestArchivedSchema,
  organizationTeamRestMemberListSchema,
  organizationTeamRestMemberSchema,
  organizationTeamRestPageSchema,
  organizationTeamRestSchema,
  organizationTeamRoleSchema,
  type OrganizationApi,
  type OrganizationCaller,
  type OrganizationTeam,
  type UpdateOrganizationTeamInput,
} from "@langwatch/organization-contract";
import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  type RestTransportDeclaration,
} from "@langwatch/api/rest";
import type { AuthzApi, AuthzTeamMemberBinding } from "@langwatch/authz-contract";
import { moduleApi } from "@langwatch/runtime-composition";
import { SYSTEM_ACTORS } from "@langwatch/actor";
import { z } from "zod";

/**
 * What the `/api/teams` family reaches, as flat operations the organization's
 * own application serves.
 *
 * Every member is implemented by `ServerOrganizationApp`, which declares
 * `implements TeamManagementApi` — so a route naming something the application
 * does not serve fails the build rather than the first request. This family
 * used to ask for two injected accessors (`authz()`, `projects()`) that only an
 * apps/api mount file supplied; when that file was deleted the family lost its
 * only caller and stopped being registered at all.
 *
 * The seven organization operations and the one authorization read are taken
 * straight off {@link OrganizationApi} and {@link AuthzApi} so they cannot
 * drift from the contracts that already declare them. `updateTeam` is spelled
 * out because it is implemented by `OrganizationService` and reached by this
 * door alone, so it has never been on the peer-facing contract.
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

export const TeamManagementApi = moduleApi<TeamManagementApi>("organization");

/**
 * Who a write is attributed to: the member the credential acts as, or the
 * management API itself for a service key, which acts as nobody.
 */
const callerOf = (actor: { type: string; id?: string } | null): OrganizationCaller =>
  actor && actor.type === "user" && actor.id
    ? { id: actor.id }
    : { id: SYSTEM_ACTORS.managementApi };

/**
 * Wire schemas the REST family uses but which live in the contract, imported
 * above alongside the response shapes the application already computed.
 */
const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(1000).optional().default(50),
});

const createTeamSchema = z.object({
  name: z.string().min(1, "name is required").max(255),
});

const updateTeamSchema = z.object({
  name: z.string().min(1).max(255).optional(),
});

const addMemberSchema = z.object({
  userId: z.string().min(1, "userId is required"),
  role: organizationTeamRoleSchema.optional().default("MEMBER"),
});

const teamParamsSchema = z.object({ id: z.string().min(1) });
const teamMemberParamsSchema = teamParamsSchema.extend({ userId: z.string().min(1) });

const successSchema = z.object({ success: z.boolean() });
const teamProjectListSchema = z.object({ data: z.array(z.unknown()) });

/**
 * The team's response shape: the stored shape omits the personal flag and owner,
 * so the wire is narrower.
 */
function teamResponse(team: OrganizationTeam) {
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
  .withQuery(paginationQuerySchema)
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
  .withInput(createTeamSchema)
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

  .get("/:id", "getTeam")
  .withPermission("team:view")
  .withParams(teamParamsSchema)
  .withOutput(organizationTeamRestSchema)
  .withDocs({
    tags: ["Teams"],
    description: "Get a team by its id",
  })
  .handle(async ({ app, input, scope }) =>
    teamResponse(
      await app.getTeam({
        teamId: input.id,
        organizationId: scope.id,
      }),
    ),
  )

  .patch("/:id", "updateTeam")
  .withPermission("team:manage")
  .withParams(teamParamsSchema)
  .withInput(updateTeamSchema)
  .withOutput(organizationTeamRestSchema)
  .withDocs({
    tags: ["Teams"],
    description: "Update a team by its id",
  })
  .handle(async ({ app, input, scope }) =>
    teamResponse(
      await app.updateTeam({
        teamId: input.id,
        organizationId: scope.id,
        ...(input.name === undefined ? {} : { name: input.name }),
      }),
    ),
  )

  .delete("/:id", "archiveTeam")
  .withPermission("team:manage")
  .withParams(teamParamsSchema)
  .withOutput(organizationTeamRestArchivedSchema)
  .withDocs({
    tags: ["Teams"],
    description: "Archive a team (soft-delete)",
  })
  .handle(async ({ app, input, scope }) => {
    const team = await app.archiveTeam({
      teamId: input.id,
      organizationId: scope.id,
    });

    return {
      id: team.id,
      name: team.name,
      archivedAt: team.archivedAt ?? null,
    };
  })

  .get("/:id/members", "listTeamMembers")
  .withPermission("team:view")
  .withParams(teamParamsSchema)
  .withOutput(organizationTeamRestMemberListSchema)
  .withDocs({
    tags: ["Teams"],
    description: "List members of a team",
  })
  .handle(async ({ app, input, scope }) => {
    // Reads the team first so a team outside the organization is a 404 rather
    // than an empty membership list.
    await app.getTeam({
      teamId: input.id,
      organizationId: scope.id,
    });

    const bindings = await app.listTeamMemberBindings({
      organizationId: scope.id,
      teamIds: [input.id],
    });

    return {
      data: (bindings.get(input.id) ?? []).map(memberResponse),
    };
  })

  .post("/:id/members", "addTeamMember")
  .withPermission("team:manage")
  .withParams(teamParamsSchema)
  .withInput(addMemberSchema)
  .withOutput(successSchema)
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
      teamId: input.id,
      organizationId: scope.id,
      userId: input.userId,
      role: input.role,
      actor: ledgerActor,
    });

    return { success: true };
  })

  .delete("/:id/members/:userId", "removeTeamMember")
  .withPermission("team:manage")
  .withParams(teamMemberParamsSchema)
  .withOutput(successSchema)
  .withDocs({
    tags: ["Teams"],
    description: "Remove a member from a team",
  })
  .handle(async ({ app, input, scope, actor }) => {
    await app.removeTeamMember(
      {
        teamId: input.id,
        organizationId: scope.id,
        userId: input.userId,
      },
      callerOf(actor),
    );

    return { success: true };
  })

  .get("/:id/projects", "listTeamProjects")
  .withPermission("team:view")
  .withParams(teamParamsSchema)
  .withOutput(teamProjectListSchema)
  .withDocs({
    tags: ["Teams"],
    description: "List projects in a team",
  })
  .handle(async ({ app, input, scope }) => {
    await app.getTeam({
      teamId: input.id,
      organizationId: scope.id,
    });

    return {
      data: await app.listProjectsByTeam({
        organizationId: scope.id,
        teamId: input.id,
      }),
    };
  })

  .build();
