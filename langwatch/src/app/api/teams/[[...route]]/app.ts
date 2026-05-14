import type { Organization } from "@prisma/client";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { validator as zValidator } from "hono-openapi/zod";
import { z } from "zod";
import {
  TeamNotFoundError,
  type TeamRestService,
} from "~/server/app-layer/teams/team.service";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import type { OrgAuthMiddlewareVariables } from "../../middleware/org-auth";
import { orgAuthMiddleware, requireOrgPermission } from "../../middleware/org-auth";
import type { TeamServiceMiddlewareVariables } from "../../middleware/team-service";
import { teamServiceMiddleware } from "../../middleware/team-service";
import { loggerMiddleware } from "../../middleware/logger";
import { tracerMiddleware } from "../../middleware/tracer";
import { NotFoundError } from "../../shared/errors";
import { handleTeamError } from "./error-handler";

patchZodOpenapi();

type Variables = OrgAuthMiddlewareVariables & TeamServiceMiddlewareVariables;

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

export const app = new Hono<{ Variables: Variables }>()
  .basePath("/api/teams")
  .use(tracerMiddleware({ name: "teams" }))
  .use(loggerMiddleware())
  .use(orgAuthMiddleware)
  .use(teamServiceMiddleware)
  .onError(handleTeamError)

  .get(
    "/",
    describeRoute({
      description: "List all non-archived teams for the organization (paginated)",
    }),
    requireOrgPermission("team:view"),
    zValidator("query", paginationQuerySchema),
    async (c) => {
      const organization = c.get("organization") as Organization;
      const { page, limit } = c.req.valid("query");
      const service = c.get("teamService") as TeamRestService;

      const result = await service.listByOrganization({
        organizationId: organization.id,
        page,
        limit,
      });

      return c.json({
        data: result.data.map(teamResponse),
        pagination: result.pagination,
      });
    },
  )

  .post(
    "/",
    describeRoute({
      description: "Create a new team",
    }),
    requireOrgPermission("team:create"),
    zValidator("json", createTeamSchema, validationHook),
    async (c) => {
      const organization = c.get("organization") as Organization;
      const body = c.req.valid("json");
      const service = c.get("teamService") as TeamRestService;

      const team = await service.create({
        organizationId: organization.id,
        name: body.name,
      });

      return c.json(teamResponse(team), 201);
    },
  )

  .get(
    "/:id",
    describeRoute({
      description: "Get a team by its id",
    }),
    requireOrgPermission("team:view"),
    async (c) => {
      const { id } = c.req.param();
      const organization = c.get("organization") as Organization;
      const service = c.get("teamService") as TeamRestService;

      const team = await service.getById({
        id,
        organizationId: organization.id,
      });
      if (!team) {
        throw new NotFoundError("Team not found");
      }

      return c.json(teamResponse(team));
    },
  )

  .patch(
    "/:id",
    describeRoute({
      description: "Update a team by its id",
    }),
    requireOrgPermission("team:update"),
    zValidator("json", updateTeamSchema, validationHook),
    async (c) => {
      const { id } = c.req.param();
      const organization = c.get("organization") as Organization;
      const body = c.req.valid("json");
      const service = c.get("teamService") as TeamRestService;

      let team;
      try {
        team = await service.update({
          id,
          organizationId: organization.id,
          data: {
            ...(body.name !== undefined && { name: body.name }),
          },
        });
      } catch (error) {
        if (error instanceof TeamNotFoundError) {
          throw new NotFoundError("Team not found");
        }
        throw error;
      }

      return c.json(teamResponse(team));
    },
  )

  .delete(
    "/:id",
    describeRoute({
      description: "Archive a team (soft-delete)",
    }),
    requireOrgPermission("team:delete"),
    async (c) => {
      const { id } = c.req.param();
      const organization = c.get("organization") as Organization;
      const service = c.get("teamService") as TeamRestService;

      let team;
      try {
        team = await service.archive({
          id,
          organizationId: organization.id,
        });
      } catch (error) {
        if (error instanceof TeamNotFoundError) {
          throw new NotFoundError("Team not found");
        }
        throw error;
      }

      return c.json({
        id: team.id,
        name: team.name,
        archivedAt: team.archivedAt,
      });
    },
  );
