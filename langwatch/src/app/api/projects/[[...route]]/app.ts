import type { Organization } from "@prisma/client";
import { describeRoute } from "hono-openapi";
import { validator as zValidator } from "hono-openapi/zod";
import { z } from "zod";
import {
  DestinationTeamNotFoundError,
  ProjectNotFoundError,
  ProjectSlugConflictError,
  TeamNotInOrganizationError,
  type ProjectService,
} from "~/server/app-layer/projects/project.service";
import type { ApiKeyService } from "~/server/api-key/api-key.service";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { createOrgApp, requires } from "~/server/api/security";
import type { ApiKeyServiceMiddlewareVariables } from "../../middleware/api-key-service";
import { apiKeyServiceMiddleware } from "../../middleware/api-key-service";
import type { ProjectServiceMiddlewareVariables } from "../../middleware/project-service";
import { projectServiceMiddleware } from "../../middleware/project-service";
import {
  BadRequestError,
  NotFoundError,
} from "../../shared/errors";
import { handleProjectError } from "./error-handler";

patchZodOpenapi();

type ExtraVariables = ProjectServiceMiddlewareVariables & ApiKeyServiceMiddlewareVariables;

const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(1000).optional().default(50),
});

const createProjectSchema = z.object({
  name: z.string().min(1, "name is required").max(255),
  teamId: z.string().min(1).optional(),
  newTeamName: z.string().min(1).max(255).optional(),
  language: z.string().min(1, "language is required"),
  framework: z.string().min(1, "framework is required"),
}).refine((data) => data.teamId || data.newTeamName, {
  message: "Either teamId or newTeamName must be provided",
});

const updateProjectSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  language: z.string().optional(),
  framework: z.string().optional(),
  piiRedactionLevel: z.enum(["STRICT", "ESSENTIAL", "DISABLED"]).optional(),
  teamId: z.string().min(1).optional(),
});

function validationHook(
  result: { success: boolean; error?: { issues: Array<{ message?: string; path?: (string | number)[] }> } },
  c: { json: (body: unknown, status: number) => Response },
): Response | undefined {
  if (!result.success) {
    const issue = result.error?.issues?.[0];
    return c.json(
      {
        error: "Unprocessable Entity",
        message: issue?.message ?? "Validation failed",
        path: issue?.path,
      },
      422,
    );
  }
  return undefined;
}

function projectResponse(project: {
  id: string;
  name: string;
  slug: string;
  language: string;
  framework: string;
  teamId: string;
  createdAt: Date;
  updatedAt: Date;
  piiRedactionLevel: string;
}) {
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    language: project.language,
    framework: project.framework,
    teamId: project.teamId,
    piiRedactionLevel: project.piiRedactionLevel,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

const secured = createOrgApp<ExtraVariables>({
  basePath: "/api/projects",
});

secured.hono.onError(handleProjectError);

secured
  .access(requires("project:view"))
  .get(
    "/",
    projectServiceMiddleware,
    describeRoute({
      description: "List all non-archived projects for the organization (paginated)",
    }),
    zValidator("query", paginationQuerySchema),
    async (c) => {
      const organization = c.get("organization") as Organization;
      const { page, limit } = c.req.valid("query");
      const service = c.get("projectService") as ProjectService;

      const result = await service.listByOrganization({
        organizationId: organization.id,
        page,
        limit,
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
    describeRoute({
      description: "Create a new project",
    }),
    zValidator("json", createProjectSchema, validationHook),
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
        if (error instanceof ProjectSlugConflictError) {
          return c.json(
            { error: "Conflict", message: error.message },
            409,
          );
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

secured
  .access(requires("project:view"))
  .get(
    "/:id",
    projectServiceMiddleware,
    describeRoute({
      description: "Get a project by its id",
    }),
    async (c) => {
      const { id } = c.req.param();
      const organization = c.get("organization") as Organization;
      const service = c.get("projectService") as ProjectService;

      const project = await service.getWithTeam(id);
      if (!project || project.team.organizationId !== organization.id) {
        throw new NotFoundError("Project not found");
      }

      return c.json(projectResponse(project));
    },
  );

secured
  .access(requires("project:update"))
  .patch(
    "/:id",
    projectServiceMiddleware,
    describeRoute({
      description: "Update a project by its id",
    }),
    zValidator("json", updateProjectSchema, validationHook),
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
            ...(body.piiRedactionLevel !== undefined && {
              piiRedactionLevel: body.piiRedactionLevel,
            }),
            ...(body.teamId !== undefined && { teamId: body.teamId }),
          },
        });
      } catch (error) {
        if (error instanceof ProjectNotFoundError) {
          throw new NotFoundError("Project not found");
        }
        if (error instanceof DestinationTeamNotFoundError) {
          throw new BadRequestError(error.message);
        }
        throw error;
      }

      return c.json(projectResponse(project));
    },
  );

secured
  .access(requires("project:delete"))
  .delete(
    "/:id",
    projectServiceMiddleware,
    describeRoute({
      description: "Archive a project (soft-delete)",
    }),
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
        throw error;
      }

      return c.json({
        id: project.id,
        name: project.name,
        archivedAt: project.archivedAt,
      });
    },
  );

export const app = secured.hono;
