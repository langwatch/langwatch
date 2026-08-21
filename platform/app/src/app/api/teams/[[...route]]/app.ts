import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { orgRequestLedgerActor } from "~/app/api/shared/ledger-actor";
import {
  type Organization,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { createOrgApp, requires } from "~/server/api/security";
import { validator as zValidator } from "~/server/api/validation";
import {
  TeamNotFoundError,
  type TeamRestService,
} from "~/server/app-layer/teams/team.service";
import { prisma } from "~/server/db";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import type { TeamServiceMiddlewareVariables } from "../../middleware/team-service";
import { teamServiceMiddleware } from "../../middleware/team-service";
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

secured.access(requires("team:view")).get(
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
  .access(
    /* no bag grants team:create; only team:manage implies it (registry vocabulary) */ requires(
      "team:manage",
    ),
  )
  .post(
    "/",
    teamServiceMiddleware,
    describeRoute({
      description: "Create a new team that can group projects and members",
    }),
    zValidator("json", createTeamSchema),
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

secured.access(requires("team:view")).get(
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
      throw new TeamNotFoundError(id);
    }

    return c.json(teamResponse(team));
  },
);

secured.access(requires("team:manage")).patch(
  "/:id",
  teamServiceMiddleware,
  describeRoute({
    description: "Update a team by its id",
  }),
  zValidator("json", updateTeamSchema),
  async (c) => {
    const { id } = c.req.param();
    const organization = c.get("organization") as Organization;
    const body = c.req.valid("json");
    const service = c.get("teamService") as TeamRestService;

    const team = await service.update({
      id,
      organizationId: organization.id,
      data: {
        ...(body.name !== undefined && { name: body.name }),
      },
    });

    return c.json(teamResponse(team));
  },
);

secured.access(requires("team:manage")).delete(
  "/:id",
  teamServiceMiddleware,
  describeRoute({
    description: "Archive a team (soft-delete)",
  }),
  async (c) => {
    const { id } = c.req.param();
    const organization = c.get("organization") as Organization;
    const service = c.get("teamService") as TeamRestService;

    const team = await service.archive({
      id,
      organizationId: organization.id,
    });

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

      const team = await service.getById({
        id,
        organizationId: organization.id,
      });
      if (!team) throw new TeamNotFoundError(id);

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
    zValidator("json", addMemberSchema),
    async (c) => {
      const { id } = c.req.param();
      const organization = c.get("organization") as Organization;
      const body = c.req.valid("json");
      const service = c.get("teamService") as TeamRestService;

      await service.addMember({
        id,
        organizationId: organization.id,
        userId: body.userId,
        role: body.role,
        actor: orgRequestLedgerActor(c),
      });

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

      await service.removeMember({
        id,
        organizationId: organization.id,
        userId,
        actor: orgRequestLedgerActor(c),
      });

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

      const team = await service.getById({
        id,
        organizationId: organization.id,
      });
      if (!team) throw new TeamNotFoundError(id);

      const projects = await prisma.project.findMany({
        where: {
          teamId: id,
          archivedAt: null,
          kind: { not: "internal_governance" },
        },
        select: {
          id: true,
          name: true,
          slug: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: "desc" },
      });

      return c.json({ data: projects });
    },
  );

export const app = secured.hono;
