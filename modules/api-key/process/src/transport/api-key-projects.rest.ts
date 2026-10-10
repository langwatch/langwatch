import {
  projectRestCreateSchema,
  projectRestCreatedSchema,
  projectRestPageSchema,
  projectRestPaginationQuerySchema,
} from "@langwatch/api-key-contract";
/**
 * `GET`/`POST /api/projects`: the organization's projects as the presented key
 * reaches them, and provisioning with a minted service key. Served by api-key,
 * which owns the key, at project's published path (ARCHITECTURE.md §8, R10).
 */
import { anyAuthenticated } from "@langwatch/api/access";
import {
  BadRequestError,
  defineRestRouter,
  ForbiddenError,
  HttpError,
  MANAGEMENT_API_VERSION,
} from "@langwatch/api/rest";
import { moduleApi } from "@langwatch/module";
import {
  PersonalWorkspaceBoundaryError,
  ProjectSlugConflictError,
  TeamNotInOrganizationError,
  type PaginatedProjects,
  type Project,
} from "@langwatch/project-contract";

import { apiKeyRestCredential } from "./api-key.rest.ts";

/** What the projects collection door reaches; `ApiKeyModule` serves it. */
export interface ApiKeyProjectsDoorApi {
  /** The organization's projects, cut to those the presented key reaches. */
  listVisibleProjects(
    input: Readonly<{
      apiKeyId: string;
      userId: string | null;
      organizationId: string;
      page: number;
      limit: number;
    }>,
  ): Promise<PaginatedProjects>;
  /** A project provisioned in the organization, with its freshly minted service key. */
  provisionProject(input: ProjectProvisioningRequest): Promise<ProvisionedProject>;
}

/** What a provisioning request names: the project, and the team it goes into or creates. */
type ProjectProvisioningRequest = Readonly<{
  organizationId: string;
  userId: string | null;
  teamId?: string | undefined;
  newTeamName?: string | undefined;
  name: string;
  language: string;
  framework: string;
}>;

/** A provisioned project, with the service key minted beside it. */
type ProvisionedProject = Readonly<{
  project: Project;
  serviceKey: Readonly<{ token: string; apiKeyId: string }>;
}>;

export const ApiKeyProjectsDoorApi = moduleApi<ApiKeyProjectsDoorApi>()("api-key");

const PROJECTS_SHARED_PATH = {
  owner: "project",
  reason: "the collection reads and mints keys, so api-key serves it at project's path (R3, R10)",
  deprecate: "fold into /api/projects once project serves its collection without api-key",
} as const;

const PROJECT_INVALID_TOKEN: Readonly<{ status: 401; description: string }> = {
  status: 401,
  description: "Invalid or missing API key token",
};

/**
 * The listing is not gated on organization-wide `project:view`: a credential
 * whose view does not reach organization scope gets a 200 with exactly the
 * projects it holds `project:view` on instead of a 403.
 */
const LISTING_ANSWERS_WHAT_THE_KEY_REACHES =
  "the listing answers exactly the projects the presented credential already reaches, resolved per key, so authentication is the whole gate and a narrower key is filtered rather than refused";

export const apiKeyProjectsRest = defineRestRouter(ApiKeyProjectsDoorApi)
  .withNamespace("projects")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("organization")
  .withAddressing("literal", { v1Twin: false })

  .get("/api/projects", "listProjects")
  .withSharedPath(PROJECTS_SHARED_PATH)
  .withQuery(projectRestPaginationQuerySchema)
  .withAccess(anyAuthenticated({ reason: LISTING_ANSWERS_WHAT_THE_KEY_REACHES }))
  .withOutput(projectRestPageSchema)
  .withDocs({
    summary: "List projects",
    description:
      "List all non-archived projects for the organization (paginated). Requires an admin API key with project:view permission.",
    errors: [
      PROJECT_INVALID_TOKEN,
      { status: 403, description: "Insufficient permissions for this operation" },
    ],
  })
  .withMiddlewareContext(apiKeyRestCredential)
  .handle(async ({ app, input, scope }, credential) => {
    const result = await app.listVisibleProjects({
      apiKeyId: credential.apiKeyId,
      userId: credential.userId,
      organizationId: scope.id,
      page: input.page,
      limit: input.limit,
    });

    return { data: result.data.map(projectResponse), pagination: result.pagination };
  })

  .post("/api/projects", "createProject")
  .withSharedPath(PROJECTS_SHARED_PATH)
  .withInput(projectRestCreateSchema)
  .withPermission("project:create")
  .withOutput(projectRestCreatedSchema)
  .withStatus(201)
  .withDocs({
    summary: "Create a project",
    description:
      "Create a new project in the organization. Returns the project with a newly minted service API key (serviceApiKey) for sending traces. Provide either teamId (existing team) or newTeamName (creates a new team). Requires project:create permission.",
    errors: [
      { status: 400, description: "Team does not belong to this organization" },
      PROJECT_INVALID_TOKEN,
      { status: 403, description: "Insufficient permissions (requires project:create)" },
      { status: 409, description: "A project with this name already exists in the team" },
      { status: 422, description: "Validation error (missing required fields)" },
    ],
  })
  .withMiddlewareContext(apiKeyRestCredential)
  .withAudit("management.project.create")
  .handle(async ({ app, input, scope }, credential) => {
    const { project, serviceKey } = await provisionProject({
      app,
      input: {
        organizationId: scope.id,
        userId: credential.userId,
        teamId: input.teamId,
        newTeamName: input.newTeamName,
        name: input.name,
        language: input.language,
        framework: input.framework,
      },
    });

    return {
      ...projectResponse(project),
      serviceApiKey: serviceKey.token,
      serviceApiKeyId: serviceKey.apiKeyId,
    };
  })
  .build();

/** One project, as every route in the projects family reports it. */
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

/** The provisioning refusals, as the status codes this family answers with. */
async function provisionProject({
  app,
  input,
}: {
  app: ApiKeyProjectsDoorApi;
  input: ProjectProvisioningRequest;
}): Promise<ProvisionedProject> {
  try {
    return await app.provisionProject(input);
  } catch (error) {
    if (error instanceof TeamNotInOrganizationError) throw new BadRequestError(error.message);
    if (error instanceof PersonalWorkspaceBoundaryError) throw new ForbiddenError(error.message);
    if (error instanceof ProjectSlugConflictError) throw new ProjectSlugConflict(error.message);

    throw error;
  }
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
