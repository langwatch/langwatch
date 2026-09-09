/**
 * `/api/projects` — the organization's own projects, and the ingestion
 * credential of each. The door resolves the ORGANIZATION, so the five by-id
 * routes ask their permission at the project the path names instead.
 * Spec: specs/ai-governance/cli-onboarding/login-user-scoped-key.feature
 *       specs/api-keys/project-key-read-access.feature
 */
import { anyAuthenticated } from "@langwatch/api/access";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import { ApiKeyNotFoundError } from "@langwatch/api-key-contract";
import {
  BadRequestError,
  defineRestMiddleware,
  defineRestRouter,
  ForbiddenError,
  HttpError,
  MANAGEMENT_API_VERSION,
  NotFoundError,
} from "@langwatch/api/rest";
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
  ProjectSlugConflictError,
  TeamNotInOrganizationError,
  type Project,
  type ProjectService,
  type ProjectWithTeam,
} from "@langwatch/project-contract";
import { moduleApi } from "@langwatch/runtime-composition";
import { z } from "zod";

import {
  ARCHIVE_PROJECT,
  CREATE_PROJECT,
  GET_PROJECT,
  GET_PROJECT_API_KEY,
  LIST_PROJECTS,
  REGENERATE_PROJECT_API_KEY,
  UPDATE_PROJECT,
} from "../rules/project-openapi.rules.ts";

/**
 * What the management door reaches: this module's own project directory, and
 * the credential service that mints a service key and rotates the ingestion
 * key. Two accessors, because those are the boundaries the routes call.
 */
export interface ProjectManagementApi {
  projects(): ProjectService;
  apiKeys(): ApiKeyApi;
}

export const ProjectManagementApi = moduleApi<ProjectManagementApi>("project");

/**
 * The organization credential this door resolved: the key, and the member it
 * acts as — null for a service key, which acts as nobody.
 */
export const projectRestCredential = defineRestMiddleware(
  "projectRestCredential",
  z.object({ apiKeyId: z.string(), userId: z.string().nullable() }),
);

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

/**
 * The project a by-id route addresses. The parameter is spelled `projectId`
 * because that is the field a project-tier permission is resolved from, so the
 * tier a route checks at comes from the name and cannot disagree with it.
 */
const projectParamsSchema = z.object({ projectId: z.string().min(1) });

/**
 * The listing is not gated on organization-wide `project:view`: a credential
 * whose view does not reach organization scope gets a 200 with exactly the
 * projects it holds `project:view` on instead of a 403.
 */
const LISTING_ANSWERS_WHAT_THE_KEY_REACHES =
  "the listing answers exactly the projects the presented credential already reaches, resolved per key, so authentication is the whole gate and a narrower key is filtered rather than refused";

export const projectRest = defineRestRouter(ProjectManagementApi)
  .withNamespace("projects")
  .withVersion(MANAGEMENT_API_VERSION)
  // No derived twin: `/api/v1/projects` belongs to the LangWatch-QL family.
  .withAddressing("dated", { v1Twin: false })
  .withCredential("organizationKey")

  .get("/", "listProjects")
  .withQuery(paginationQuerySchema)
  .withAccess(anyAuthenticated({ reason: LISTING_ANSWERS_WHAT_THE_KEY_REACHES }))
  .withOutput(projectRestPageSchema)
  .withDocs(LIST_PROJECTS)
  .withMiddleware(projectRestCredential)
  .handle(async ({ app, input, scope }, credential) => {
    const visible = await app.apiKeys().resolveVisibleProjects({
      apiKeyId: credential.apiKeyId,
      organizationId: scope.id,
    });

    const result = await app.projects().listByOrganization({
      organizationId: scope.id,
      page: input.page,
      limit: input.limit,
      ...(visible.kind === "some" ? { projectIds: visible.ids } : {}),
    });

    return { data: result.data.map(projectResponse), pagination: result.pagination };
  })

  .post("/", "createProject")
  .withInput(createProjectSchema)
  .withPermission("project:create")
  .withOutput(projectRestCreatedSchema)
  .withStatus(201)
  .withDocs(CREATE_PROJECT)
  .withMiddleware(projectRestCredential)
  .handle(async ({ app, input, scope }, credential) => {
    const project = await provisionProject({
      app,
      input,
      organizationId: scope.id,
      userId: credential.userId,
    });

    const serviceKey = await app.apiKeys().create({
      name: `${project.name} Service Key`,
      userId: null,
      createdByUserId: credential.userId,
      organizationId: scope.id,
      permissionMode: "all",
      bindings: [{ role: "ADMIN", scopeType: "PROJECT", scopeId: project.id }],
    });

    return {
      ...projectResponse(project),
      serviceApiKey: serviceKey.token,
      serviceApiKeyId: serviceKey.apiKey.id,
    };
  })

  .get("/:projectId", "getProject")
  .withParams(projectParamsSchema)
  .withPermission("project:view", { at: "route", param: "projectId" })
  .withOutput(projectRestSchema)
  .withDocs(GET_PROJECT)
  .handle(async ({ app, input, scope }) =>
    projectResponse(
      await projectInOrganization({ app, id: input.projectId, organizationId: scope.id }),
    ),
  )

  .patch("/:projectId", "updateProject")
  .withParams(projectParamsSchema)
  .withInput(updateProjectSchema)
  .withPermission("project:update", { at: "route", param: "projectId" })
  .withOutput(projectRestSchema)
  .withDocs(UPDATE_PROJECT)
  .handle(async ({ app, input, scope }) => {
    try {
      return projectResponse(
        await app.projects().update({
          id: input.projectId,
          organizationId: scope.id,
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
  })

  .delete("/:projectId", "archiveProject")
  .withParams(projectParamsSchema)
  .withPermission("project:delete", { at: "route", param: "projectId" })
  .withOutput(projectRestArchivedSchema)
  .withDocs(ARCHIVE_PROJECT)
  .handle(async ({ app, input, scope }) => {
    const project = await archiveProject({ app, id: input.projectId, organizationId: scope.id });

    return { id: project.id, name: project.name, archivedAt: project.archivedAt };
  })

  // The base key is a project-level write credential, so reading it is gated
  // with `project:update` to match the access it grants — not `project:view`.
  .get("/:projectId/api-key", "getProjectApiKey")
  .withParams(projectParamsSchema)
  .withPermission("project:update", { at: "route", param: "projectId" })
  .withOutput(projectApiKeyRotationSchema)
  .withDocs(GET_PROJECT_API_KEY)
  .handle(async ({ app, input, scope }) => ({
    apiKey: (await projectInOrganization({ app, id: input.projectId, organizationId: scope.id }))
      .apiKey,
  }))

  .post("/:projectId/regenerate-api-key", "regenerateProjectApiKey")
  .withParams(projectParamsSchema)
  .withPermission("project:manage", { at: "route", param: "projectId" })
  .withOutput(projectApiKeyRotationSchema)
  .withDocs(REGENERATE_PROJECT_API_KEY)
  .handle(async ({ app, input, scope }) => {
    await projectInOrganization({ app, id: input.projectId, organizationId: scope.id });

    return { apiKey: await rotateIngestionKey({ app, projectId: input.projectId }) };
  })
  .build();

/** One project, as every route in this family reports it. */
function projectResponse(
  project: Pick<
    Project,
    "id" | "name" | "slug" | "language" | "framework" | "teamId" | "createdAt" | "updatedAt"
  >,
) {
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

/** The project this route addresses, refusing anything outside the organization. */
async function projectInOrganization({
  app,
  id,
  organizationId,
}: {
  app: ProjectManagementApi;
  id: string;
  organizationId: string;
}): Promise<ProjectWithTeam> {
  const project = await app.projects().tryGetWithTeam(id);

  if (!project || project.team.organizationId !== organizationId) {
    throw new NotFoundError("Project not found");
  }

  return project;
}

/** The provisioning refusals, as the status codes this family answers with. */
async function provisionProject({
  app,
  input,
  organizationId,
  userId,
}: {
  app: ProjectManagementApi;
  input: Readonly<{
    name: string;
    language: string;
    framework: string;
    teamId?: string | undefined;
    newTeamName?: string | undefined;
  }>;
  organizationId: string;
  userId: string | null;
}): Promise<Project> {
  try {
    return await app.projects().create({
      organizationId,
      userId,
      teamId: input.teamId,
      newTeamName: input.newTeamName,
      name: input.name,
      language: input.language,
      framework: input.framework,
    });
  } catch (error) {
    if (error instanceof TeamNotInOrganizationError) throw new BadRequestError(error.message);
    if (error instanceof PersonalWorkspaceBoundaryError) throw new ForbiddenError(error.message);
    if (error instanceof ProjectSlugConflictError) throw new ProjectSlugConflict(error.message);

    throw error;
  }
}

/** The archive refusals, as the status codes this family answers with. */
async function archiveProject({
  app,
  id,
  organizationId,
}: {
  app: ProjectManagementApi;
  id: string;
  organizationId: string;
}): Promise<Project> {
  try {
    return await app.projects().archive({ id, organizationId });
  } catch (error) {
    if (error instanceof ProjectNotFoundError) throw new NotFoundError("Project not found");
    if (error instanceof PersonalProjectProtectedError) throw new ForbiddenError(error.message);

    throw error;
  }
}

/**
 * A project whose credential the service cannot find reads as a project this
 * family does not have, which is what the caller can act on.
 */
async function rotateIngestionKey({
  app,
  projectId,
}: {
  app: ProjectManagementApi;
  projectId: string;
}): Promise<string> {
  try {
    return await app.apiKeys().regenerateLegacyProjectKey({ projectId });
  } catch (error) {
    if (error instanceof ApiKeyNotFoundError) throw new NotFoundError("Project not found");

    throw error;
  }
}

/** The service's update failures, as the status codes they mean. */
function asProjectUpdateHttpError(error: unknown): unknown {
  if (error instanceof ProjectNotFoundError) return new NotFoundError("Project not found");
  if (error instanceof DestinationTeamNotFoundError) return new BadRequestError(error.message);
  if (error instanceof PersonalWorkspaceBoundaryError) return new ForbiddenError(error.message);

  return error;
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
