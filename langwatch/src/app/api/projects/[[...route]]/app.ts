import type { Organization } from "@prisma/client";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { validator as zValidator } from "hono-openapi/zod";
import { z } from "zod";
import {
  ProjectNotFoundError,
  ProjectSlugConflictError,
  TeamNotInOrganizationError,
  type ProjectService,
} from "~/server/app-layer/projects/project.service";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import type { OrgAuthMiddlewareVariables } from "../../middleware/org-auth";
import { orgAuthMiddleware } from "../../middleware/org-auth";
import type { ProjectServiceMiddlewareVariables } from "../../middleware/project-service";
import { projectServiceMiddleware } from "../../middleware/project-service";
import { loggerMiddleware } from "../../middleware/logger";
import { tracerMiddleware } from "../../middleware/tracer";
import {
  BadRequestError,
  NotFoundError,
} from "../../shared/errors";
import { handleProjectError } from "./error-handler";

patchZodOpenapi();

type Variables = OrgAuthMiddlewareVariables & ProjectServiceMiddlewareVariables;

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

export const app = new Hono<{ Variables: Variables }>()
  .basePath("/api/projects")
  .use(tracerMiddleware({ name: "projects" }))
  .use(loggerMiddleware())
  .use(orgAuthMiddleware)
  .use(projectServiceMiddleware)
  .onError(handleProjectError)

  .get(
    "/",
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
  )

  .post(
    "/",
    describeRoute({
      description: "Create a new project",
    }),
    zValidator("json", createProjectSchema, validationHook),
    async (c) => {
      const organization = c.get("organization") as Organization;
      const body = c.req.valid("json");
      const service = c.get("projectService") as ProjectService;
      const userId = c.get("patUserId") as string;

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

      return c.json(
        {
          ...projectResponse(project),
          apiKey: project.apiKey,
        },
        201,
      );
    },
  )

  .get(
    "/:id",
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

      return c.json({
        ...projectResponse(project),
        apiKey: project.apiKey,
      });
    },
  )

  .patch(
    "/:id",
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
          },
        });
      } catch (error) {
        if (error instanceof ProjectNotFoundError) {
          throw new NotFoundError("Project not found");
        }
        throw error;
      }

      return c.json(projectResponse(project));
    },
  )

  .delete(
    "/:id",
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
