import { describeRoute } from "hono-openapi";
import { organizationTeamRoleSchema } from "@langwatch/organization-contract";
import { z } from "zod/v4";
import { orgRequestLedgerActor } from "~/app/api/shared/ledger-actor";
import { createOrgApp, requires } from "~/server/api/security";
import { validator as zValidator } from "~/server/api/validation";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
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
  role: organizationTeamRoleSchema.optional().default("MEMBER"),
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

const secured = createOrgApp({
  basePath: "/api/teams",
});

secured.hono.onError(handleTeamError);

secured.access(requires("team:view")).get(
  "/",
  describeRoute({
    description: "List all non-archived teams for the organization (paginated)",
  }),
  zValidator("query", paginationQuerySchema),
  async (c) => {
    const organization = c.get("organization");
    const { page, limit } = c.req.valid("query");
    const service = c.var.langwatchApp.organizations;

    const result = await service.listTeams({
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
    describeRoute({
      description: "Create a new team that can group projects and members",
    }),
    zValidator("json", createTeamSchema),
    async (c) => {
      const organization = c.get("organization");
      const body = c.req.valid("json");
      const service = c.var.langwatchApp.organizations;

      const team = await service.createTeam({
        organizationId: organization.id,
        name: body.name,
      });

      return c.json(teamResponse(team), 201);
    },
  );

secured.access(requires("team:view")).get(
  "/:id",
  describeRoute({
    description: "Get a team by its id",
  }),
  async (c) => {
    const { id } = c.req.param();
    const organization = c.get("organization");
    const service = c.var.langwatchApp.organizations;

    const team = await service.getTeam({
      teamId: id,
      organizationId: organization.id,
    });

    return c.json(teamResponse(team));
  },
);

secured.access(requires("team:manage")).patch(
  "/:id",
  describeRoute({
    description: "Update a team by its id",
  }),
  zValidator("json", updateTeamSchema),
  async (c) => {
    const { id } = c.req.param();
    const organization = c.get("organization");
    const body = c.req.valid("json");
    const service = c.var.langwatchApp.organizations;

    const team = await service.updateTeam({
      teamId: id,
      organizationId: organization.id,
      ...(body.name === undefined ? {} : { name: body.name }),
    });

    return c.json(teamResponse(team));
  },
);

secured.access(requires("team:manage")).delete(
  "/:id",
  describeRoute({
    description: "Archive a team (soft-delete)",
  }),
  async (c) => {
    const { id } = c.req.param();
    const organization = c.get("organization");
    const service = c.var.langwatchApp.organizations;

    const team = await service.archiveTeam({
      teamId: id,
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
    describeRoute({ description: "List members of a team" }),
    async (c) => {
      const { id } = c.req.param();
      const organization = c.get("organization");
      const service = c.var.langwatchApp.organizations;

      await service.getTeam({
        teamId: id,
        organizationId: organization.id,
      });

      const bindings = await c.var.langwatchApp.permissions.listScopeBindings({
        organizationId: organization.id,
        scopeType: "TEAM",
        scopeIds: [id],
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
    describeRoute({ description: "Add a member to a team" }),
    zValidator("json", addMemberSchema),
    async (c) => {
      const { id } = c.req.param();
      const organization = c.get("organization");
      const body = c.req.valid("json");
      const service = c.var.langwatchApp.organizations;

      await service.addTeamMember({
        teamId: id,
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
    describeRoute({ description: "Remove a member from a team" }),
    async (c) => {
      const { id, userId } = c.req.param();
      const organization = c.get("organization");
      const service = c.var.langwatchApp.organizations;

      await service.removeTeamMember({
        teamId: id,
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
    describeRoute({ description: "List projects in a team" }),
    async (c) => {
      const { id } = c.req.param();
      const organization = c.get("organization");
      const service = c.var.langwatchApp.organizations;

      await service.getTeam({
        teamId: id,
        organizationId: organization.id,
      });

      const projects = await c.var.langwatchApp.projects.listByTeam({
        organizationId: organization.id,
        teamId: id,
      });

      return c.json({ data: projects });
    },
  );

export const app = secured.hono;
