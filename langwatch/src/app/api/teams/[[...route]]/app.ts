import {
  RoleBindingScopeType,
  TeamUserRole,
  type Organization,
} from "@prisma/client";
import { generate } from "@langwatch/ksuid";
import { describeRoute } from "hono-openapi";
import { validator as zValidator } from "hono-openapi/zod";
import { z } from "zod";
import {
  TeamNotFoundError,
  type TeamRestService,
} from "~/server/app-layer/teams/team.service";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { createOrgApp, requires } from "~/server/api/security";
import { prisma } from "~/server/db";
import { KSUID_RESOURCES } from "~/utils/constants";
import type { TeamServiceMiddlewareVariables } from "../../middleware/team-service";
import { teamServiceMiddleware } from "../../middleware/team-service";
import { BadRequestError, NotFoundError } from "../../shared/errors";
import { handleTeamError } from "./error-handler";

patchZodOpenapi();

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
  role: z.nativeEnum(TeamUserRole).optional().default(TeamUserRole.MEMBER),
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

const secured = createOrgApp<TeamServiceMiddlewareVariables>({
  basePath: "/api/teams",
});

secured.hono.onError(handleTeamError);

secured
  .access(requires("team:view"))
  .get(
    "/",
    teamServiceMiddleware,
    describeRoute({
      description: "List all non-archived teams for the organization (paginated)",
    }),
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
  );

secured
  .access(requires("team:create"))
  .post(
    "/",
    teamServiceMiddleware,
    describeRoute({
      description: "Create a new team",
    }),
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
  );

secured
  .access(requires("team:view"))
  .get(
    "/:id",
    teamServiceMiddleware,
    describeRoute({
      description: "Get a team by its id",
    }),
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
  );

secured
  .access(requires("team:update"))
  .patch(
    "/:id",
    teamServiceMiddleware,
    describeRoute({
      description: "Update a team by its id",
    }),
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
  );

secured
  .access(requires("team:delete"))
  .delete(
    "/:id",
    teamServiceMiddleware,
    describeRoute({
      description: "Archive a team (soft-delete)",
    }),
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

// ── Members ──────────────────────────────────────────────────────────────────

secured
  .access(requires("team:view"))
  .get(
    "/:id/members",
    teamServiceMiddleware,
    describeRoute({ description: "List members of a team" }),
    async (c) => {
      const { id } = c.req.param();
      const organization = c.get("organization") as Organization;
      const service = c.get("teamService") as TeamRestService;

      const team = await service.getById({ id, organizationId: organization.id });
      if (!team) throw new NotFoundError("Team not found");

      const bindings = await prisma.roleBinding.findMany({
        where: {
          organizationId: organization.id,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: id,
          userId: { not: null },
        },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      });

      return c.json({
        data: bindings.map((b) => ({
          userId: b.userId,
          name: b.user?.name ?? null,
          email: b.user?.email ?? null,
          role: b.role,
        })),
      });
    },
  );

secured
  .access(requires("team:manage"))
  .post(
    "/:id/members",
    teamServiceMiddleware,
    describeRoute({ description: "Add a member to a team" }),
    zValidator("json", addMemberSchema, validationHook),
    async (c) => {
      const { id } = c.req.param();
      const organization = c.get("organization") as Organization;
      const body = c.req.valid("json");
      const service = c.get("teamService") as TeamRestService;

      const team = await service.getById({ id, organizationId: organization.id });
      if (!team) throw new NotFoundError("Team not found");

      const orgMember = await prisma.organizationUser.findFirst({
        where: { organizationId: organization.id, userId: body.userId },
        select: { userId: true },
      });
      if (!orgMember) {
        throw new BadRequestError("User must belong to the organization");
      }

      try {
        await prisma.roleBinding.create({
          data: {
            id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
            organizationId: organization.id,
            userId: body.userId,
            role: body.role,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: id,
          },
        });
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          (error as { code: string }).code === "P2002"
        ) {
          throw new BadRequestError("User is already a member of this team");
        }
        throw error;
      }

      return c.json({ success: true }, 201);
    },
  );

secured
  .access(requires("team:manage"))
  .delete(
    "/:id/members/:userId",
    teamServiceMiddleware,
    describeRoute({ description: "Remove a member from a team" }),
    async (c) => {
      const { id, userId } = c.req.param();
      const organization = c.get("organization") as Organization;
      const service = c.get("teamService") as TeamRestService;

      const team = await service.getById({ id, organizationId: organization.id });
      if (!team) throw new NotFoundError("Team not found");

      const binding = await prisma.roleBinding.findFirst({
        where: {
          organizationId: organization.id,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: id,
          userId,
        },
      });
      if (!binding) throw new NotFoundError("Member not found on this team");

      await prisma.roleBinding.delete({ where: { id: binding.id } });
      return c.json({ success: true });
    },
  );

// ── Projects ─────────────────────────────────────────────────────────────────

secured
  .access(requires("team:view"))
  .get(
    "/:id/projects",
    teamServiceMiddleware,
    describeRoute({ description: "List projects in a team" }),
    async (c) => {
      const { id } = c.req.param();
      const organization = c.get("organization") as Organization;
      const service = c.get("teamService") as TeamRestService;

      const team = await service.getById({ id, organizationId: organization.id });
      if (!team) throw new NotFoundError("Team not found");

      const projects = await prisma.project.findMany({
        where: { teamId: id, archivedAt: null, kind: { not: "internal_governance" } },
        select: { id: true, name: true, slug: true, createdAt: true, updatedAt: true },
        orderBy: { createdAt: "desc" },
      });

      return c.json({ data: projects });
    },
  );

export const app = secured.hono;
