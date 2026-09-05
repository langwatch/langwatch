/**
 * The organization-scoped `/api/projects` REST family.
 * Spec: specs/ai-governance/cli-onboarding/login-user-scoped-key.feature
 */
import type { ApiKeyService } from "@langwatch/api-key-contract";
import { ApiKeyNotFoundError } from "@langwatch/api-key-contract";
import type { ResolvedOrganizationApiKeyToken as OrgResolvedToken } from "@langwatch/api-key-contract";
import {
  DestinationTeamNotFoundError,
  PersonalProjectProtectedError,
  PersonalWorkspaceBoundaryError,
  projectApiKeyRotationSchema,
  ProjectNotFoundError,
  projectRestArchivedSchema,
  projectRestCreatedSchema,
  projectRestPageSchema,
  projectRestSchema,
  type ProjectService,
  ProjectSlugConflictError,
  TeamNotInOrganizationError,
} from "@langwatch/project-contract";
import type { Context } from "hono";
import { z } from "zod";
import { anyAuthenticated, requires, requiresOnProject } from "@langwatch/api";
import {
  type AppRestSecurity,
  BadRequestError,
  createFamilyErrorHandler,
  ForbiddenError,
  handWrittenDocs,
  HttpError,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
  NotFoundError,
  promoteSchemaFailures,
} from "@langwatch/api/rest";
import {
  ARCHIVE_PROJECT,
  CREATE_PROJECT,
  GET_PROJECT,
  GET_PROJECT_API_KEY,
  LIST_PROJECTS,
  REGENERATE_PROJECT_API_KEY,
  UPDATE_PROJECT,
} from "../../rules/project-openapi.rules";

const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(1000).optional().default(50),
});

const createProjectSchema = z
  .object({
    name: z.string().min(1, "name is required").max(255).describe("Project name"),
    teamId: z.string().min(1).optional().describe("Id of an existing team to put the project in"),
    newTeamName: z
      .string()
      .min(1)
      .max(255)
      .optional()
      .describe("Create a team with this name and put the project in it"),
    language: z
      .string()
      .min(1, "language is required")
      .describe("Programming language, such as python or typescript"),
    framework: z
      .string()
      .min(1, "framework is required")
      .describe("Framework in use, such as langchain or openai"),
  })
  .refine((data) => data.teamId || data.newTeamName, {
    message: "Either teamId or newTeamName must be provided",
  });

const updateProjectSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  language: z.string().optional(),
  framework: z.string().optional(),
  teamId: z.string().min(1).optional().describe("Moves the project to this team"),
});

function projectResponse(project: {
  id: string;
  name: string;
  slug: string;
  language: string;
  framework: string;
  teamId: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    language: project.language,
    framework: project.framework,
    teamId: project.teamId,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

/**
 * The slug clash, in the flat body this family has always answered. A plain
 * {@link HttpError} would publish the sentence as the `error` field; this door
 * publishes the class of refusal there and the sentence beside it.
 */
class ProjectSlugConflict extends HttpError {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.error = "Conflict";
  }
}

const idParamsSchema = z.object({ id: z.string().min(1) });

/** The service's update failures, as the status codes they mean. */
function asProjectUpdateHttpError(error: unknown): unknown {
  if (error instanceof ProjectNotFoundError) {
    return new NotFoundError("Project not found");
  }
  if (error instanceof DestinationTeamNotFoundError) {
    return new BadRequestError(error.message);
  }
  if (error instanceof PersonalWorkspaceBoundaryError) {
    return new ForbiddenError(error.message);
  }
  return error;
}

/**
 * The `/api/projects` family, built against one process's security.
 */
export function createProjectRestApp(options: {
  security: AppRestSecurity;
  projects: () => ProjectService;
  apiKeys: () => ApiKeyService;
}): MountableRestApp {
  const { security, projects, apiKeys } = options;

  const { service, policy } = security.createVersionedApp({
    name: "projects",
    basePath: "/api/projects",
    // No derived twin: `/api/v1/projects` belongs to the LangWatch-QL family.
    v1Alias: false,
    errorEnvelope: "legacy",
    errorHandler: (boundary) =>
      promoteSchemaFailures(
        createFamilyErrorHandler({
          loggerName: "langwatch:api:projects:errors",
          label: "Projects API Error",
          boundary,
        }),
      ),
  });

  /** The project this route addresses, refusing anything outside the organization. */
  const projectInOrganization = async (c: Context, id: string) => {
    const project = await projects().tryGetWithTeam(id);
    if (!project || project.team.organizationId !== c.get("organization").id) {
      throw new NotFoundError("Project not found");
    }
    return project;
  };

  const listHandler = async (c: Context, input: z.infer<typeof paginationQuerySchema>) => {
    const organization = c.get("organization");

    // Read the resolved credential itself rather than the loose context key:
    // this family authenticates organization API keys only, so `apiKeyId` is
    // always a real key here, and taking it from the typed token is what keeps
    // that true if the family ever grows another credential class.
    const resolved = c.get("orgResolvedToken") as OrgResolvedToken;

    const visible = await apiKeys().resolveVisibleProjects({
      apiKeyId: resolved.apiKeyId,
      organizationId: organization.id,
    });

    const result = await projects().listByOrganization({
      organizationId: organization.id,
      page: input.page,
      limit: input.limit,
      ...(visible.kind === "some" ? { projectIds: visible.ids } : {}),
    });

    return {
      data: result.data.map(projectResponse),
      pagination: result.pagination,
    };
  };

  const createHandler = async (c: Context, input: z.infer<typeof createProjectSchema>) => {
    const organization = c.get("organization");
    const userId = c.get("apiKeyUserId");

    let project;
    try {
      project = await projects().create({
        organizationId: organization.id,
        userId,
        teamId: input.teamId,
        newTeamName: input.newTeamName,
        name: input.name,
        language: input.language,
        framework: input.framework,
      });
    } catch (error) {
      if (error instanceof TeamNotInOrganizationError) {
        throw new BadRequestError(error.message);
      }
      if (error instanceof PersonalWorkspaceBoundaryError) {
        throw new ForbiddenError(error.message);
      }
      if (error instanceof ProjectSlugConflictError) {
        throw new ProjectSlugConflict(error.message);
      }
      throw error;
    }

    const serviceKey = await apiKeys().create({
      name: `${project.name} Service Key`,
      userId: null,
      createdByUserId: userId,
      organizationId: organization.id,
      permissionMode: "all",
      bindings: [{ role: "ADMIN", scopeType: "PROJECT", scopeId: project.id }],
    });

    return {
      ...projectResponse(project),
      serviceApiKey: serviceKey.token,
      serviceApiKeyId: serviceKey.apiKey.id,
    };
  };

  const getHandler = async (c: Context, input: z.infer<typeof idParamsSchema>) =>
    projectResponse(await projectInOrganization(c, input.id));

  const updateHandler = async (
    c: Context,
    input: z.infer<typeof idParamsSchema> & z.infer<typeof updateProjectSchema>,
  ) => {
    try {
      return projectResponse(
        await projects().update({
          id: input.id,
          organizationId: c.get("organization").id,
          data: {
            ...(input.name !== undefined && { name: input.name }),
            ...(input.language !== undefined && { language: input.language }),
            ...(input.framework !== undefined && { framework: input.framework }),
            ...(input.teamId !== undefined && { teamId: input.teamId }),
          },
        }),
      );
    } catch (error) {
      throw asProjectUpdateHttpError(error);
    }
  };

  const archiveHandler = async (c: Context, input: z.infer<typeof idParamsSchema>) => {
    let project;
    try {
      project = await projects().archive({
        id: input.id,
        organizationId: c.get("organization").id,
      });
    } catch (error) {
      if (error instanceof ProjectNotFoundError) {
        throw new NotFoundError("Project not found");
      }
      if (error instanceof PersonalProjectProtectedError) {
        throw new ForbiddenError(error.message);
      }
      throw error;
    }
    return { id: project.id, name: project.name, archivedAt: project.archivedAt };
  };

  const readApiKeyHandler = async (c: Context, input: z.infer<typeof idParamsSchema>) => ({
    apiKey: (await projectInOrganization(c, input.id)).apiKey,
  });

  const regenerateApiKeyHandler = async (c: Context, input: z.infer<typeof idParamsSchema>) => {
    await projectInOrganization(c, input.id);
    try {
      return { apiKey: await apiKeys().regenerateLegacyProjectKey({ projectId: input.id }) };
    } catch (error) {
      if (error instanceof ApiKeyNotFoundError) {
        throw new NotFoundError("Project not found");
      }
      throw error;
    }
  };

  return (
    service
      // The listing is not gated on organization-wide `project:view`: a credential whose view
      // does not reach org scope gets a 200 with exactly the projects it holds `project:view`
      // on (key bindings ∩ owner ceiling, resolved by `resolveVisibleProjects`) instead of a
      // 403. Spec: specs/ai-governance/cli-onboarding/login-user-scoped-key.feature
      .registerRoute("get", "/", MANAGEMENT_API_VERSION, listHandler, (b) =>
        policy(anyAuthenticated())(b)
          .withQuery(paginationQuerySchema)
          .withOutput(projectRestPageSchema)
          .withDocs(handWrittenDocs(LIST_PROJECTS)),
      )
      .registerRoute("post", "/", MANAGEMENT_API_VERSION, createHandler, (b) =>
        policy(requires("project:create"))(b)
          .withInput(createProjectSchema)
          .withOutput(projectRestCreatedSchema)
          .withStatus(201)
          .withDocs(handWrittenDocs(CREATE_PROJECT)),
      )
      .registerRoute("get", "/:id", MANAGEMENT_API_VERSION, getHandler, (b) =>
        policy(requiresOnProject("project:view"))(b)
          .withParams(idParamsSchema)
          .withOutput(projectRestSchema)
          .withDocs(handWrittenDocs(GET_PROJECT)),
      )
      .registerRoute("patch", "/:id", MANAGEMENT_API_VERSION, updateHandler, (b) =>
        policy(requiresOnProject("project:update"))(b)
          .withParams(idParamsSchema)
          .withInput(updateProjectSchema)
          .withOutput(projectRestSchema)
          .withDocs(handWrittenDocs(UPDATE_PROJECT)),
      )
      .registerRoute("delete", "/:id", MANAGEMENT_API_VERSION, archiveHandler, (b) =>
        policy(requiresOnProject("project:delete"))(b)
          .withParams(idParamsSchema)
          .withOutput(projectRestArchivedSchema)
          .withDocs(handWrittenDocs(ARCHIVE_PROJECT)),
      )
      // The base key is a project-level write credential, so reading it is gated with
      // `project:update` to match the access it grants — not `project:view`.
      .registerRoute("get", "/:id/api-key", MANAGEMENT_API_VERSION, readApiKeyHandler, (b) =>
        policy(requiresOnProject("project:update"))(b)
          .withParams(idParamsSchema)
          .withOutput(projectApiKeyRotationSchema)
          .withDocs(handWrittenDocs(GET_PROJECT_API_KEY)),
      )
      .registerRoute(
        "post",
        "/:id/regenerate-api-key",
        MANAGEMENT_API_VERSION,
        regenerateApiKeyHandler,
        (b) =>
          policy(requiresOnProject("project:manage"))(b)
            .withParams(idParamsSchema)
            .withOutput(projectApiKeyRotationSchema)
            .withDocs(handWrittenDocs(REGENERATE_PROJECT_API_KEY)),
      )
      .build()
  );
}
