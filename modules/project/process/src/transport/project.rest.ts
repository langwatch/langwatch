/**
 * `/api/projects/:id` — one of the organization's projects and its base key.
 * The door resolves the ORGANIZATION; each route asks at the project the path
 * names. The collection is api-key's (api-key-projects.rest.ts).
 */
import { anyAuthenticated } from "@langwatch/api/access";
import {
  defineRestRouter,
  ForbiddenError,
  MANAGEMENT_API_VERSION,
  NotFoundError,
} from "@langwatch/api/rest";
import type {
  DataPrivacyApi,
  DataPrivacyPiiRedactionLevel,
} from "@langwatch/data-privacy-contract";
import { moduleApi } from "@langwatch/module";
import {
  PersonalProjectProtectedError,
  projectApiKeyRotationSchema,
  ProjectNotFoundError,
  projectRestArchivedSchema,
  projectRestParamsSchema,
  projectRestRegenerateApiKeyInputSchema,
  projectRestDetailSchema,
  projectRestUpdateSchema,
  type ArchivedProject,
  type Project,
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
 * What the management door reaches: flat operations `ProjectModule` serves via
 * `implements ProjectManagementApi`, so an unsupplied member fails the build.
 * `userId` is the credential's owner, null for a key acting for nobody.
 */
export interface ProjectManagementApi extends Pick<
  DataPrivacyApi,
  "getPiiRedactionLevel" | "setPiiRedactionLevel"
> {
  /**
   * One of this organization's projects; the governance project, and an
   * aggregate the owner may not open (ADR-175), throw `ProjectNotFoundError`.
   */
  getInOrganization(
    input: Readonly<{ projectId: string; organizationId: string; userId: string | null }>,
  ): Promise<ProjectWithTeam>;
  /**
   * Writes exactly the fields the request carried, scoped to the organization
   * the credential resolved — never to the project's own organization, which
   * would let a token issued for one organization write to another's project.
   */
  updateInOrganization(
    input: Readonly<{
      projectId: string;
      organizationId: string;
      userId: string | null;
      data: UpdateProjectInput;
    }>,
  ): Promise<Project>;
  /**
   * Archives one of this organization's projects, answering with the row it
   * archived — this family publishes `{ id, name, archivedAt }`, so a bare
   * "already archived" verdict would not serve it.
   */
  archiveInOrganization(
    input: Readonly<{ projectId: string; organizationId: string; userId: string | null }>,
  ): Promise<ArchivedProject>;
}

export const ProjectManagementApi = moduleApi<ProjectManagementApi>()("project");

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

  .get("/:id", "getProject")
  .withParams(projectRestParamsSchema)
  .withPermission("project:view", { at: "route", param: "projectId", field: "id" })
  .withOutput(projectRestDetailSchema)
  .withDocs({
    summary: "Get a project",
    description: "Get a project by ID. Requires project:view permission.",
    errors: [PROJECT_INVALID_TOKEN, PROJECT_INSUFFICIENT_PERMISSIONS, PROJECT_NOT_FOUND],
  })
  .handle(async ({ app, input, scope, actor }) => {
    const project = await projectInOrganization({
      app,
      id: input.id,
      organizationId: scope.id,
      ...keyOwner(actor),
    });

    return {
      ...projectResponse(project),
      piiRedactionLevel: await app.getPiiRedactionLevel({ projectId: project.id }),
    };
  })

  .patch("/:id", "updateProject")
  .withParams(projectRestParamsSchema)
  .withInput(projectRestUpdateSchema)
  .withPermission("project:update", { at: "route", param: "projectId", field: "id" })
  .withOutput(projectRestDetailSchema)
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
  .handle(({ app, input, scope, actor }) =>
    updateProject({ app, input, organizationId: scope.id, ...keyOwner(actor) }),
  )

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
  .handle(async ({ app, input, scope, actor }) => {
    const project = await archiveProject({
      app,
      id: input.id,
      organizationId: scope.id,
      ...keyOwner(actor),
    });

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

/** The organization door's actor is the key's owner; a service key acts for nobody. */
function keyOwner(actor: { type: string; id?: string } | null): { userId: string | null } {
  return { userId: actor?.type === "user" && actor.id ? actor.id : null };
}

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

/**
 * The project this route addresses, refusing anything outside the organization.
 * What no list shows this caller (the governance project, an aggregate to a
 * non-admin) reads as absent, since answering would confirm it exists.
 */
async function projectInOrganization({
  app,
  id,
  organizationId,
  userId,
}: {
  app: ProjectManagementApi;
  id: string;
  organizationId: string;
  userId: string | null;
}): Promise<ProjectWithTeam> {
  try {
    return await app.getInOrganization({ projectId: id, organizationId, userId });
  } catch (error) {
    if (error instanceof ProjectNotFoundError) throw new NotFoundError("Project not found");
    throw error;
  }
}

/** The update, then the PII level if one was sent, answering the level read back. */
async function updateProject({
  app,
  input,
  organizationId,
  userId,
}: {
  app: ProjectManagementApi;
  input: Readonly<{
    id: string;
    name?: string | undefined;
    language?: string | undefined;
    framework?: string | undefined;
    teamId?: string | undefined;
    piiRedactionLevel?: DataPrivacyPiiRedactionLevel | undefined;
  }>;
  organizationId: string;
  userId: string | null;
}) {
  const project = await app.updateInOrganization({
    projectId: input.id,
    organizationId,
    userId,
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.language !== undefined && { language: input.language }),
      ...(input.framework !== undefined && { framework: input.framework }),
      ...(input.teamId !== undefined && { teamId: input.teamId }),
    },
  });
  if (input.piiRedactionLevel !== undefined) {
    await app.setPiiRedactionLevel({ projectId: project.id, level: input.piiRedactionLevel });
  }

  return {
    ...projectResponse(project),
    piiRedactionLevel: await app.getPiiRedactionLevel({ projectId: project.id }),
  };
}

/** The archive refusals, as the status codes this family answers with. */
async function archiveProject({
  app,
  id,
  organizationId,
  userId,
}: {
  app: ProjectManagementApi;
  id: string;
  organizationId: string;
  userId: string | null;
}): Promise<ArchivedProject> {
  try {
    return await app.archiveInOrganization({ projectId: id, organizationId, userId });
  } catch (error) {
    if (error instanceof ProjectNotFoundError) throw new NotFoundError("Project not found");
    if (error instanceof PersonalProjectProtectedError) throw new ForbiddenError(error.message);

    throw error;
  }
}
