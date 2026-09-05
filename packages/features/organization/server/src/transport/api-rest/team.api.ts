import type { AuthzService } from "@langwatch/authz-contract";
import {
  organizationTeamRestArchivedSchema,
  organizationTeamRestMemberListSchema,
  organizationTeamRestPageSchema,
  organizationTeamRestSchema,
  organizationTeamRoleSchema,
  type OrganizationLedgerActor,
  type OrganizationService,
} from "@langwatch/organization-contract";
import { projectSchema, type ProjectService } from "@langwatch/project-contract";
import type { Context } from "hono";
import { z } from "zod";

import { requires, requiresOnTeam } from "@langwatch/api";
import {
  type AppRestSecurity,
  createFamilyErrorHandler,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
} from "@langwatch/api/rest";

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

/** The team's projects, exactly as the project feature stores them. */
const teamProjectListSchema = z.object({ data: z.array(projectSchema) });

const successSchema = z.object({ success: z.boolean() });

function teamResponse(team: {
  id: string;
  name: string;
  slug: string;
  organizationId: string;
  createdAt: Date;
  updatedAt: Date;
}) {
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
 * REST for the organization's teams, their members and their projects.
 */
export function createTeamsRestApp(options: {
  security: AppRestSecurity;
  /**
   * Resolved per request, as reading them off the Hono context used to be:
   * mounting a family must not force its services to be constructed, which is
   * what lets the OpenAPI spec generator build this app with none.
   */
  organizations: () => OrganizationService;
  permissions: () => AuthzService;
  projects: () => ProjectService;
  /** Who a REST write is attributed to in the grants ledger (ADR-092). */
  ledgerActor: (c: Context<any>) => OrganizationLedgerActor;
}): MountableRestApp {
  const { security, organizations, permissions, projects, ledgerActor } = options;

  const { service, policy } = security.createVersionedApp({
    name: "teams",
    basePath: "/api/teams",
    errorEnvelope: "legacy",
    errorHandler: (boundary) =>
      createFamilyErrorHandler({
        loggerName: "langwatch:api:teams:errors",
        label: "Teams API Error",
        boundary,
      }),
  });

  const organizationId = (c: Context): string => c.get("organization").id;

  const listHandler = async (c: Context, input: z.infer<typeof paginationQuerySchema>) => {
    const result = await organizations().listTeams({
      organizationId: organizationId(c),
      page: input.page,
      limit: input.limit,
    });
    return { data: result.data.map(teamResponse), pagination: result.pagination };
  };

  const createHandler = async (c: Context, input: z.infer<typeof createTeamSchema>) =>
    teamResponse(
      await organizations().createTeam({
        organizationId: organizationId(c),
        name: input.name,
      }),
    );

  const getHandler = async (c: Context, input: z.infer<typeof teamParamsSchema>) =>
    teamResponse(
      await organizations().getTeam({ teamId: input.id, organizationId: organizationId(c) }),
    );

  const updateHandler = async (
    c: Context,
    input: z.infer<typeof teamParamsSchema> & z.infer<typeof updateTeamSchema>,
  ) =>
    teamResponse(
      await organizations().updateTeam({
        teamId: input.id,
        organizationId: organizationId(c),
        ...(input.name === undefined ? {} : { name: input.name }),
      }),
    );

  const archiveHandler = async (c: Context, input: z.infer<typeof teamParamsSchema>) => {
    const team = await organizations().archiveTeam({
      teamId: input.id,
      organizationId: organizationId(c),
    });
    return { id: team.id, name: team.name, archivedAt: team.archivedAt };
  };

  const listMembersHandler = async (c: Context, input: z.infer<typeof teamParamsSchema>) => {
    // Reads the team first so a team outside the organization is a 404 rather
    // than an empty membership list.
    await organizations().getTeam({ teamId: input.id, organizationId: organizationId(c) });

    const bindings = await permissions().listScopeBindings({
      organizationId: organizationId(c),
      scopeType: "TEAM",
      scopeIds: [input.id],
    });

    return {
      data: bindings.map((b) => ({
        userId: b.userId,
        name: b.user?.name ?? null,
        email: b.user?.email ?? null,
        role: b.role,
      })),
    };
  };

  const addMemberHandler = async (
    c: Context,
    input: z.infer<typeof teamParamsSchema> & z.infer<typeof addMemberSchema>,
  ) => {
    await organizations().addTeamMember({
      teamId: input.id,
      organizationId: organizationId(c),
      userId: input.userId,
      role: input.role,
      actor: ledgerActor(c),
    });
    return { success: true };
  };

  const removeMemberHandler = async (c: Context, input: z.infer<typeof teamMemberParamsSchema>) => {
    await organizations().removeTeamMember({
      teamId: input.id,
      organizationId: organizationId(c),
      userId: input.userId,
      actor: ledgerActor(c),
    });
    return { success: true };
  };

  const listProjectsHandler = async (c: Context, input: z.infer<typeof teamParamsSchema>) => {
    await organizations().getTeam({ teamId: input.id, organizationId: organizationId(c) });

    return {
      data: await projects().listByTeam({
        organizationId: organizationId(c),
        teamId: input.id,
      }),
    };
  };

  return (
    service
      .registerRoute("get", "/", MANAGEMENT_API_VERSION, listHandler, (b) =>
        policy(requires("team:view"))(b)
          .withQuery(paginationQuerySchema)
          .withOutput(organizationTeamRestPageSchema)
          .withDocs({
            operationId: "listTeams",
            tags: ["Teams"],
            description: "List all non-archived teams for the organization (paginated)",
          }),
      )
      // No bag grants team:create; only team:manage implies it (registry vocabulary).
      .registerRoute("post", "/", MANAGEMENT_API_VERSION, createHandler, (b) =>
        policy(requires("team:manage"))(b)
          .withInput(createTeamSchema)
          .withOutput(organizationTeamRestSchema)
          .withStatus(201)
          .withDocs({
            operationId: "createTeam",
            tags: ["Teams"],
            description: "Create a new team that can group projects and members",
          }),
      )
      .registerRoute("get", "/:id", MANAGEMENT_API_VERSION, getHandler, (b) =>
        policy(requiresOnTeam("team:view"))(b)
          .withParams(teamParamsSchema)
          .withOutput(organizationTeamRestSchema)
          .withDocs({
            operationId: "getTeam",
            tags: ["Teams"],
            description: "Get a team by its id",
          }),
      )
      .registerRoute("patch", "/:id", MANAGEMENT_API_VERSION, updateHandler, (b) =>
        policy(requiresOnTeam("team:manage"))(b)
          .withParams(teamParamsSchema)
          .withInput(updateTeamSchema)
          .withOutput(organizationTeamRestSchema)
          .withDocs({
            operationId: "updateTeam",
            tags: ["Teams"],
            description: "Update a team by its id",
          }),
      )
      .registerRoute("delete", "/:id", MANAGEMENT_API_VERSION, archiveHandler, (b) =>
        policy(requiresOnTeam("team:manage"))(b)
          .withParams(teamParamsSchema)
          .withOutput(organizationTeamRestArchivedSchema)
          .withDocs({
            operationId: "archiveTeam",
            tags: ["Teams"],
            description: "Archive a team (soft-delete)",
          }),
      )
      .registerRoute("get", "/:id/members", MANAGEMENT_API_VERSION, listMembersHandler, (b) =>
        policy(requiresOnTeam("team:view"))(b)
          .withParams(teamParamsSchema)
          .withOutput(organizationTeamRestMemberListSchema)
          .withDocs({
            operationId: "listTeamMembers",
            tags: ["Teams"],
            description: "List members of a team",
          }),
      )
      .registerRoute("post", "/:id/members", MANAGEMENT_API_VERSION, addMemberHandler, (b) =>
        policy(requiresOnTeam("team:manage"))(b)
          .withParams(teamParamsSchema)
          .withInput(addMemberSchema)
          .withOutput(successSchema)
          .withStatus(201)
          .withDocs({
            operationId: "addTeamMember",
            tags: ["Teams"],
            description: "Add a member to a team",
          }),
      )
      .registerRoute(
        "delete",
        "/:id/members/:userId",
        MANAGEMENT_API_VERSION,
        removeMemberHandler,
        (b) =>
          policy(requiresOnTeam("team:manage"))(b)
            .withParams(teamMemberParamsSchema)
            .withOutput(successSchema)
            .withDocs({
              operationId: "removeTeamMember",
              tags: ["Teams"],
              description: "Remove a member from a team",
            }),
      )
      .registerRoute("get", "/:id/projects", MANAGEMENT_API_VERSION, listProjectsHandler, (b) =>
        policy(requiresOnTeam("team:view"))(b)
          .withParams(teamParamsSchema)
          .withOutput(teamProjectListSchema)
          .withDocs({
            operationId: "listTeamProjects",
            tags: ["Teams"],
            description: "List projects in a team",
          }),
      )
      .build()
  );
}
