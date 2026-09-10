/**
 * `/api/teams` - the organization's teams, their members, and their projects.
 * Routes that address a single team (`:id`) check permissions at team scope;
 * collection routes stay at organization scope as they operate on that whole set.
 */
import { toDate, type Instant } from "@langwatch/time";
import {
  OrganizationApi,
  organizationTeamRestArchivedSchema,
  organizationTeamRestMemberListSchema,
  organizationTeamRestMemberSchema,
  organizationTeamRestPageSchema,
  organizationTeamRestSchema,
  organizationTeamRoleSchema,
  organizationTeamSchema,
  type OrganizationTeam,
} from "@langwatch/organization-contract";
import { defineRestRouter, MANAGEMENT_API_VERSION, type RestTransportDeclaration } from "@langwatch/api/rest";
import type { AuthzService } from "@langwatch/authz-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { z } from "zod";

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
 * so the wire is narrower. Dates live as `Instant` in the app and convert here.
 */
function teamResponse(team: OrganizationTeam) {
  return {
    id: team.id,
    name: team.name,
    slug: team.slug,
    organizationId: team.organizationId,
    createdAt: toDate(team.createdAt),
    updatedAt: toDate(team.updatedAt),
  };
}

/**
 * A team member with the role their binding grants at the team's scope,
 * converted from the authz service's binding shape to the wire shape.
 */
function memberResponse(binding: {
  userId: string;
  user?: { name?: string | null; email?: string | null } | null;
  role: string;
}): z.infer<typeof organizationTeamRestMemberSchema> {
  return {
    userId: binding.userId,
    name: binding.user?.name ?? null,
    email: binding.user?.email ?? null,
    role: binding.role as z.infer<typeof organizationTeamRestMemberSchema>["role"],
  };
}

/**
 * Builds the `/api/teams` family. `authz` and `projects` are resolved by the
 * caller at mount time; they must never be read at module load, or every
 * deployment gets the default values regardless of its own configuration.
 */
export function createTeamRest(options: Readonly<{
  authz: () => AuthzService;
  projects: () => ProjectApi;
}>): Readonly<{ protocol: "rest"; namespace: string; router: () => RestTransportDeclaration<OrganizationApi> }> {
  return defineRestRouter(OrganizationApi)
    .withNamespace("teams")
    .withVersion(MANAGEMENT_API_VERSION)
    .withCredential("organization")

    .get("/", "listTeams")
    .withPermission("team:view")
    .withQuery(paginationQuerySchema)
    .withOutput(organizationTeamRestPageSchema)
    .withDocs({
      operationId: "listTeams",
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
      operationId: "createTeam",
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
      operationId: "getTeam",
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
      operationId: "updateTeam",
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
      operationId: "archiveTeam",
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
        archivedAt: team.archivedAt ? toDate(team.archivedAt) : null,
      };
    })

    .get("/:id/members", "listTeamMembers")
    .withPermission("team:view")
    .withParams(teamParamsSchema)
    .withOutput(organizationTeamRestMemberListSchema)
    .withDocs({
      operationId: "listTeamMembers",
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

      const bindings = await options.authz().listScopeBindings({
        organizationId: scope.id,
        scopeType: "TEAM",
        scopeIds: [input.id],
      });

      return {
        data: bindings.map(memberResponse),
      };
    })

    .post("/:id/members", "addTeamMember")
    .withPermission("team:manage")
    .withParams(teamParamsSchema)
    .withInput(addMemberSchema)
    .withOutput(successSchema)
    .withStatus(201)
    .withDocs({
      operationId: "addTeamMember",
      tags: ["Teams"],
      description: "Add a member to a team",
    })
    .handle(async ({ app, input, scope, actor }) => {
      const ledgerActor = actor && actor.type === "user" ? { type: "user" as const, id: actor.id ?? null } : { type: "system" as const, id: null };

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
      operationId: "removeTeamMember",
      tags: ["Teams"],
      description: "Remove a member from a team",
    })
    .handle(async ({ app, input, scope, actor }) => {
      const ledgerActor = actor && actor.type === "user" ? { type: "user" as const, id: actor.id ?? null } : { type: "system" as const, id: null };

      await app.removeTeamMember({
        teamId: input.id,
        organizationId: scope.id,
        userId: input.userId,
        actor: ledgerActor,
      });

      return { success: true };
    })

    .get("/:id/projects", "listTeamProjects")
    .withPermission("team:view")
    .withParams(teamParamsSchema)
    .withOutput(teamProjectListSchema)
    .withDocs({
      operationId: "listTeamProjects",
      tags: ["Teams"],
      description: "List projects in a team",
    })
    .handle(async ({ app, input, scope }) => {
      await app.getTeam({
        teamId: input.id,
        organizationId: scope.id,
      });

      return {
        data: await options.projects().listByTeam({
          organizationId: scope.id,
          teamId: input.id,
        }),
      };
    })

    .build();
}
