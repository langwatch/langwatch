import { describeRoute } from "hono-openapi";
import { z } from "zod";
import type { Organization } from "~/generated/prisma/client";
import {
  anyAuthenticated,
  createOrgApp,
  requires,
  requiresOnProject,
} from "~/server/api/security";
import { validator as zValidator } from "~/server/api/validation";
import type { ApiKeyService } from "~/server/api-key/api-key.service";
import { resolveVisibleProjects } from "~/server/api-key/project-visibility";
import type { OrgResolvedToken } from "~/server/api-key/token-resolver";
import {
  DestinationTeamNotFoundError,
  GovernanceProjectProtectedError,
  governanceProjectRouteViolation,
  PersonalProjectProtectedError,
  PersonalWorkspaceBoundaryError,
  ProjectNotFoundError,
  type ProjectService,
  ProjectSlugConflictError,
  TeamNotInOrganizationError,
} from "~/server/app-layer/projects/project.service";
import { prisma } from "~/server/db";
import { generateApiKey } from "~/server/utils/apiKeyGenerator";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import type { ApiKeyServiceMiddlewareVariables } from "../../middleware/api-key-service";
import { apiKeyServiceMiddleware } from "../../middleware/api-key-service";
import type { ProjectServiceMiddlewareVariables } from "../../middleware/project-service";
import { projectServiceMiddleware } from "../../middleware/project-service";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../../shared/errors";
import { handleProjectError } from "./error-handler";
import {
  ARCHIVE_PROJECT,
  CREATE_PROJECT,
  GET_PROJECT,
  GET_PROJECT_API_KEY,
  LIST_PROJECTS,
  REGENERATE_PROJECT_API_KEY,
  UPDATE_PROJECT,
} from "./openapi";

patchZodOpenapi();

type ExtraVariables = ProjectServiceMiddlewareVariables &
  ApiKeyServiceMiddlewareVariables;

const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(1000).optional().default(50),
});

const createProjectSchema = z
  .object({
    name: z
      .string()
      .min(1, "name is required")
      .max(255)
      .describe("Project name"),
    teamId: z
      .string()
      .min(1)
      .optional()
      .describe("Id of an existing team to put the project in"),
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
  teamId: z
    .string()
    .min(1)
    .optional()
    .describe("Moves the project to this team"),
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

const secured = createOrgApp<ExtraVariables>({
  basePath: "/api/projects",
});

secured.hono.onError(handleProjectError);

// The listing is not gated on organization-wide `project:view`: a credential
// whose view does not reach org scope gets a 200 with exactly the projects it
// holds `project:view` on (key bindings ∩ owner ceiling, resolved by
// `resolveVisibleProjects`) instead of a 403. Content, not access, is what the
// permission decides here, so the policy is anyAuthenticated and the handler
// does the scoping — the same shape the model-defaults family uses.
// Spec: specs/ai-governance/cli-onboarding/login-user-scoped-key.feature
secured
  .access(anyAuthenticated())
  .get(
    "/",
    projectServiceMiddleware,
    describeRoute(LIST_PROJECTS),
    zValidator("query", paginationQuerySchema),
    async (c) => {
      const organization = c.get("organization") as Organization;
      const { page, limit } = c.req.valid("query");
      const service = c.get("projectService") as ProjectService;

      // Read the resolved credential itself rather than the loose context
      // key: this family authenticates organization API keys only, so
      // `apiKeyId` is always a real key here, and taking it from the typed
      // token is what keeps that true if the family ever grows another
      // credential class.
      const resolved = c.get("orgResolvedToken") as OrgResolvedToken;

      const visible = await resolveVisibleProjects({
        prisma,
        apiKeyId: resolved.apiKeyId,
        userId: resolved.userId,
        organizationId: organization.id,
      });

      const result = await service.listByOrganization({
        organizationId: organization.id,
        page,
        limit,
        ...(visible.kind === "some" ? { projectIds: visible.ids } : {}),
      });

      return c.json({
        data: result.data.map(projectResponse),
        pagination: result.pagination,
      });
    },
  );

secured
  .access(requires("project:create"))
  .post(
    "/",
    projectServiceMiddleware,
    apiKeyServiceMiddleware,
    describeRoute(CREATE_PROJECT),
    zValidator("json", createProjectSchema),
    async (c) => {
      const organization = c.get("organization") as Organization;
      const body = c.req.valid("json");
      const service = c.get("projectService") as ProjectService;
      const userId = c.get("apiKeyUserId") as string | null;

      let project;
      try {
        project = await service.create({
          organizationId: organization.id,
          userId,
          teamId: body.teamId,
          newTeamName: body.newTeamName,
          name: body.name,
          language: body.language,
          framework: body.framework,
        });
      } catch (error) {
        if (error instanceof TeamNotInOrganizationError) {
          throw new BadRequestError(error.message);
        }
        if (error instanceof PersonalWorkspaceBoundaryError) {
          throw new ForbiddenError(error.message);
        }
        if (error instanceof ProjectSlugConflictError) {
          return c.json({ error: "Conflict", message: error.message }, 409);
        }
        throw error;
      }

      const apiKeyService = c.get("apiKeyService") as ApiKeyService;
      const serviceKey = await apiKeyService.create({
        name: `${project.name} Service Key`,
        userId: null,
        createdByUserId: userId,
        organizationId: organization.id,
        permissionMode: "all",
        bindings: [
          {
            role: "ADMIN",
            scopeType: "PROJECT",
            scopeId: project.id,
          },
        ],
      });

      return c.json(
        {
          ...projectResponse(project),
          serviceApiKey: serviceKey.token,
          serviceApiKeyId: serviceKey.apiKey.id,
        },
        201,
      );
    },
  );

/**
 * One project of this organization, addressed by id — and never the hidden
 * governance project.
 *
 * The governance project is excluded from every listing surface, so answering a
 * read about it is the one thing left that would confirm it exists. It reads as
 * not found, which is what it is as far as this API is concerned: the id
 * belongs to an internal tenancy record, not to a workspace anybody can open
 * (ADR-128 §11).
 */
async function readableProject({
  id,
  organizationId,
  service,
}: {
  id: string;
  organizationId: string;
  service: ProjectService;
}) {
  const project = await service.getWithTeam(id);
  if (
    !project ||
    project.team.organizationId !== organizationId ||
    governanceProjectRouteViolation(project.kind)
  ) {
    throw new NotFoundError("Project not found");
  }
  return project;
}

secured
  .access(requires("project:view"))
  .get(
    "/:id",
    projectServiceMiddleware,
    describeRoute(GET_PROJECT),
    async (c) => {
      const { id } = c.req.param();
      const organization = c.get("organization") as Organization;
      const service = c.get("projectService") as ProjectService;

      const project = await readableProject({
        id,
        organizationId: organization.id,
        service,
      });

      return c.json(projectResponse(project));
    },
  );

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
  // A write names an id the caller already holds, so the refusal says what the
  // record is rather than pretending it is missing — a mystery 404 on a project
  // an admin can see the id of is a support ticket.
  if (error instanceof GovernanceProjectProtectedError) {
    return new ForbiddenError(error.message);
  }
  return error;
}

secured
  .access(requires("project:update"))
  .patch(
    "/:id",
    projectServiceMiddleware,
    describeRoute(UPDATE_PROJECT),
    zValidator("json", updateProjectSchema),
    async (c) => {
      const { id } = c.req.param();
      const organization = c.get("organization") as Organization;
      const body = c.req.valid("json");
      const service = c.get("projectService") as ProjectService;

      let project;
      try {
        project = await service.update({
          id,
          organizationId: organization.id,
          data: {
            ...(body.name !== undefined && { name: body.name }),
            ...(body.language !== undefined && { language: body.language }),
            ...(body.framework !== undefined && { framework: body.framework }),
            ...(body.teamId !== undefined && { teamId: body.teamId }),
          },
        });
      } catch (error) {
        throw asProjectUpdateHttpError(error);
      }

      return c.json(projectResponse(project));
    },
  );

secured
  .access(requires("project:delete"))
  .delete(
    "/:id",
    projectServiceMiddleware,
    describeRoute(ARCHIVE_PROJECT),
    async (c) => {
      const { id } = c.req.param();
      const organization = c.get("organization") as Organization;
      const service = c.get("projectService") as ProjectService;

      let project;
      try {
        project = await service.archive({
          id,
          organizationId: organization.id,
        });
      } catch (error) {
        if (error instanceof ProjectNotFoundError) {
          throw new NotFoundError("Project not found");
        }
        if (
          error instanceof PersonalProjectProtectedError ||
          error instanceof GovernanceProjectProtectedError
        ) {
          throw new ForbiddenError(error.message);
        }
        throw error;
      }

      return c.json({
        id: project.id,
        name: project.name,
        archivedAt: project.archivedAt,
      });
    },
  );

// ── API Key management ───────────────────────────────────────────────────────

/**
 * The base key is a project-level write credential, so reading it is gated
 * with `project:update` to match the access it grants — not `project:view`.
 * `requiresOnProject` resolves that at the named project's scope rather than
 * the organization's, so one org-wide grant does not reach every project.
 */
secured
  .access(requiresOnProject("project:update"))
  .get(
    "/:id/api-key",
    projectServiceMiddleware,
    describeRoute(GET_PROJECT_API_KEY),
    async (c) => {
      const { id } = c.req.param();
      const organization = c.get("organization") as Organization;
      const service = c.get("projectService") as ProjectService;

      const project = await readableProject({
        id,
        organizationId: organization.id,
        service,
      });

      return c.json({ apiKey: project.apiKey });
    },
  );

secured
  .access(requires("project:manage"))
  .post(
    "/:id/regenerate-api-key",
    projectServiceMiddleware,
    describeRoute(REGENERATE_PROJECT_API_KEY),
    async (c) => {
      const { id } = c.req.param();
      const organization = c.get("organization") as Organization;
      const service = c.get("projectService") as ProjectService;

      // Re-keying the governance project would break the receiver's own
      // ingestion path, so the same guard the mutations carry applies here.
      await readableProject({ id, organizationId: organization.id, service });

      const newApiKey = generateApiKey();
      await prisma.project.update({
        where: { id },
        data: { apiKey: newApiKey },
      });

      return c.json({ apiKey: newApiKey });
    },
  );

export const app = secured.hono;
