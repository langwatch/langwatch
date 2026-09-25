import type { ApiKeyVisibleProjects } from "@langwatch/api-key-contract";
/**
 * `/api/projects` — the organization's own projects and each one's ingestion
 * credential. The door resolves the ORGANIZATION; the five by-id routes ask
 * permission at the project the path names. Spec: specs/api-keys/project-key-read-access.feature
 */
import { anyAuthenticated } from "@langwatch/api/access";
import {
  BadRequestError,
  defineRestMiddleware,
  defineRestRouter,
  ForbiddenError,
  HttpError,
  MANAGEMENT_API_VERSION,
  NotFoundError,
} from "@langwatch/api/rest";
import { moduleApi } from "@langwatch/kernel/module-api";
import {
  DestinationTeamNotFoundError,
  PersonalProjectProtectedError,
  PersonalWorkspaceBoundaryError,
  projectApiKeyRotationSchema,
  ProjectNotFoundError,
  projectRestCreateSchema,
  projectRestArchivedSchema,
  projectRestCreatedSchema,
  projectRestCredentialSchema,
  projectRestPaginationQuerySchema,
  projectRestParamsSchema,
  projectRestRegenerateApiKeyInputSchema,
  projectRestPageSchema,
  projectRestSchema,
  projectRestUpdateSchema,
  ProjectSlugConflictError,
  TeamNotInOrganizationError,
  type Project,
  type ProjectApi,
  type ProjectWithTeam,
  type UpdateProjectInput,
} from "@langwatch/project-contract";

const PROJECT_INVALID_TOKEN: Readonly<{ status: 401; description: string }> = {
  status: 401,
  description: "Invalid or missing API key token",
};
const PROJECT_INSUFFICIENT_PERMISSIONS: Readonly<{ status: 403; description: string }> = {
  status: 403,
  description: "Insufficient permissions for this operation",
};
const PROJECT_NOT_FOUND: Readonly<{ status: 404; description: string }> = {
  status: 404,
  description: "Project not found",
};

/**
 * What the management door reaches: flat operations `ProjectApp` serves via
 * `implements ProjectManagementApi`, so an unsupplied member fails the build
 * — not the first request. Two reads mirror {@link ProjectApi}; five are this door's own.
 */
export interface ProjectManagementApi extends Pick<
  ProjectApi,
  "listByOrganization" | "findWithTeam"
> {
  /**
   * Provisions a project in this organization. Distinct from
   * `ProjectApi.create` because a management credential may be a service key
   * (acts as nobody) — the actor here is nullable; that one's is not.
   */
  createInOrganization(
    input: Readonly<{
      organizationId: string;
      userId: string | null;
      teamId?: string | undefined;
      newTeamName?: string | undefined;
      name: string;
      language: string;
      framework: string;
    }>,
  ): Promise<Project>;
  /**
   * Writes exactly the fields the request carried, scoped to the organization
   * the credential resolved — never to the project's own organization, which
   * would let a token issued for one organization write to another's project.
   */
  updateInOrganization(
    input: Readonly<{ projectId: string; organizationId: string; data: UpdateProjectInput }>,
  ): Promise<Project>;
  /**
   * Archives one of this organization's projects, answering with the row it
   * archived — this family publishes `{ id, name, archivedAt }`, so a bare
   * "already archived" verdict would not serve it.
   */
  archiveInOrganization(
    input: Readonly<{ projectId: string; organizationId: string }>,
  ): Promise<Project>;
  /** Which of the organization's projects the presented credential reaches. */
  resolveVisibleProjects(
    input: Readonly<{ apiKeyId: string; organizationId: string }>,
  ): Promise<ApiKeyVisibleProjects>;
  /** The service key minted alongside a newly provisioned project. */
  provisionServiceKey(
    input: Readonly<{
      projectId: string;
      projectName: string;
      organizationId: string;
      createdByUserId: string | null;
    }>,
  ): Promise<{ token: string; apiKeyId: string }>;
}

export const ProjectManagementApi = moduleApi<ProjectManagementApi>()("project");

/**
 * The organization credential this door resolved: the key, and the member it
 * acts as — null for a service key, which acts as nobody.
 */
export const projectRestCredential = defineRestMiddleware(
  "projectRestCredential",
  projectRestCredentialSchema,
);

/**
 * The listing is not gated on organization-wide `project:view`: a credential
 * whose view does not reach organization scope gets a 200 with exactly the
 * projects it holds `project:view` on instead of a 403.
 */
const LISTING_ANSWERS_WHAT_THE_KEY_REACHES =
  "the listing answers exactly the projects the presented credential already reaches, resolved per key, so authentication is the whole gate and a narrower key is filtered rather than refused";

/**
 * The two base-key routes answer nothing rather than check a permission —
 * the base key outlives every membership and attributes to nobody, so a
 * gate would be worse than useless: refused, an admin just widens their token.
 */
const BASE_KEY_IS_REFUSED_TO_EVERY_TOKEN =
  "the base key is never handed to an API token, so there is no permission that would grant this and the refusal is the answer for every authenticated caller";

function refuseBaseKeyToApiToken(): never {
  throw new ForbiddenError(
    "A signed-in project administrator must manage the base API key in the browser",
  );
}

export const projectRest = defineRestRouter(ProjectManagementApi)
  .withNamespace("projects")
  .withVersion(MANAGEMENT_API_VERSION)
  // No derived twin: `/api/v1/projects` belongs to the LangWatch-QL family.
  .withAddressing("dated", { v1Twin: false })
  .withCredential("organization")

  .get("/", "listProjects")
  .withQuery(projectRestPaginationQuerySchema)
  .withAccess(anyAuthenticated({ reason: LISTING_ANSWERS_WHAT_THE_KEY_REACHES }))
  .withOutput(projectRestPageSchema)
  .withDocs({
    summary: "List projects",
    description:
      "List all non-archived projects for the organization (paginated). Requires an admin API key with project:view permission.",
    errors: [PROJECT_INVALID_TOKEN, PROJECT_INSUFFICIENT_PERMISSIONS],
  })
  .withMiddleware(projectRestCredential)
  .handle(async ({ app, input, scope }, credential) => {
    const visible = await app.resolveVisibleProjects({
      apiKeyId: credential.apiKeyId,
      organizationId: scope.id,
    });

    const result = await app.listByOrganization({
      organizationId: scope.id,
      page: input.page,
      limit: input.limit,
      ...(visible.kind === "some" ? { projectIds: visible.ids } : {}),
    });

    return { data: result.data.map(projectResponse), pagination: result.pagination };
  })

  .post("/", "createProject")
  .withInput(projectRestCreateSchema)
  .withPermission("project:create")
  .withOutput(projectRestCreatedSchema)
  .withStatus(201)
  .withDocs({
    summary: "Create a project",
    description:
      "Create a new project in the organization. Returns the project with its API key (sk-lw-...) for sending traces. Provide either teamId (existing team) or newTeamName (creates a new team). Requires project:create permission.",
    errors: [
      { status: 400, description: "Team does not belong to this organization" },
      PROJECT_INVALID_TOKEN,
      { status: 403, description: "Insufficient permissions (requires project:create)" },
      { status: 409, description: "A project with this name already exists in the team" },
      { status: 422, description: "Validation error (missing required fields)" },
    ],
  })
  .withMiddleware(projectRestCredential)
  .handle(async ({ app, input, scope }, credential) => {
    const project = await provisionProject({
      app,
      input,
      organizationId: scope.id,
      userId: credential.userId,
    });

    const serviceKey = await app.provisionServiceKey({
      projectId: project.id,
      projectName: project.name,
      organizationId: scope.id,
      createdByUserId: credential.userId,
    });

    return {
      ...projectResponse(project),
      serviceApiKey: serviceKey.token,
      serviceApiKeyId: serviceKey.apiKeyId,
    };
  })

  .get("/:id", "getProject")
  .withParams(projectRestParamsSchema)
  .withPermission("project:view", { at: "route", param: "projectId", field: "id" })
  .withOutput(projectRestSchema)
  .withDocs({
    summary: "Get a project",
    description: "Get a project by ID, including its API key. Requires project:view permission.",
    errors: [PROJECT_INVALID_TOKEN, PROJECT_INSUFFICIENT_PERMISSIONS, PROJECT_NOT_FOUND],
  })
  .handle(async ({ app, input, scope }) =>
    projectResponse(await projectInOrganization({ app, id: input.id, organizationId: scope.id })),
  )

  .patch("/:id", "updateProject")
  .withParams(projectRestParamsSchema)
  .withInput(projectRestUpdateSchema)
  .withPermission("project:update", { at: "route", param: "projectId", field: "id" })
  .withOutput(projectRestSchema)
  .withDocs({
    summary: "Update a project",
    description:
      "Update project fields. Only provided fields are changed. Requires project:update permission.",
    errors: [
      PROJECT_INVALID_TOKEN,
      { status: 403, description: "Insufficient permissions (requires project:update)" },
      PROJECT_NOT_FOUND,
    ],
  })
  .handle(async ({ app, input, scope }) => {
    try {
      return projectResponse(
        await app.updateInOrganization({
          projectId: input.id,
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

  .delete("/:id", "archiveProject")
  .withParams(projectRestParamsSchema)
  .withPermission("project:delete", { at: "route", param: "projectId", field: "id" })
  .withOutput(projectRestArchivedSchema)
  .withDocs({
    summary: "Archive a project",
    description:
      "Soft-delete (archive) a project. Archived projects are excluded from list responses. Requires project:delete permission.",
    errors: [
      PROJECT_INVALID_TOKEN,
      { status: 403, description: "Insufficient permissions (requires project:delete)" },
      PROJECT_NOT_FOUND,
    ],
  })
  .handle(async ({ app, input, scope }) => {
    const project = await archiveProject({ app, id: input.id, organizationId: scope.id });

    return { id: project.id, name: project.name, archivedAt: project.archivedAt };
  })

  // Both base-key routes are WITHDRAWN for this door, whatever the caller
  // holds. See `refuseBaseKeyToApiToken`.
  .get("/:id/api-key", "getProjectApiKey")
  .withParams(projectRestParamsSchema)
  .withAccess(anyAuthenticated({ reason: BASE_KEY_IS_REFUSED_TO_EVERY_TOKEN }))
  .withOutput(projectApiKeyRotationSchema)
  .withDocs({
    summary: "Get the project API key",
    description:
      "Deprecated. Project base keys can be revealed only by a signed-in project administrator in the browser or an approved device flow. Organization API keys are always refused with 403.",
    errors: [
      PROJECT_INVALID_TOKEN,
      {
        status: 403,
        description:
          "A signed-in project administrator is required; API-key principals cannot reveal base keys",
      },
    ],
  })
  .handle(async () => refuseBaseKeyToApiToken())

  .post("/:id/regenerate-api-key", "regenerateProjectApiKey")
  .withParams(projectRestParamsSchema)
  .withInput(projectRestRegenerateApiKeyInputSchema)
  .withAccess(anyAuthenticated({ reason: BASE_KEY_IS_REFUSED_TO_EVERY_TOKEN }))
  .withOutput(projectApiKeyRotationSchema)
  .withDocs({
    summary: "Regenerate the project API key",
    description:
      "Deprecated. Project base keys can be rotated only by a signed-in project administrator in the browser. Organization API keys are always refused with 403.",
    errors: [
      PROJECT_INVALID_TOKEN,
      {
        status: 403,
        description:
          "A signed-in project administrator is required; API-key principals cannot rotate base keys",
      },
    ],
  })
  .handle(async () => refuseBaseKeyToApiToken())
  .build();

/** One project, as every route in this family reports it. */
function projectResponse(
  project: Pick<
    Project,
    "id" | "name" | "slug" | "language" | "framework" | "teamId" | "createdAt" | "updatedAt"
  >,
): Pick<
  Project,
  "id" | "name" | "slug" | "language" | "framework" | "teamId" | "createdAt" | "updatedAt"
> {
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
  const project = await app.findWithTeam(id);

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
    return await app.createInOrganization({
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
    return await app.archiveInOrganization({ projectId: id, organizationId });
  } catch (error) {
    if (error instanceof ProjectNotFoundError) throw new NotFoundError("Project not found");
    if (error instanceof PersonalProjectProtectedError) throw new ForbiddenError(error.message);

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
