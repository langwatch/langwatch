import { createLogger } from "@langwatch/observability";
import type { Scenario } from "@prisma/client";
import { describeRoute } from "hono-openapi";
import { resolver } from "hono-openapi/zod";
import { validator as zValidator } from "~/server/api/validation";
import { z } from "zod";
import { badRequestSchema } from "~/app/api/shared/schemas";
import { requires, type SecuredApp } from "~/server/api/security";
import { prisma } from "~/server/db";
import { ScenarioNotFoundError } from "~/server/scenarios/errors";
import { ScenarioService } from "~/server/scenarios/scenario.service";
import type { AuthMiddlewareVariables } from "../../middleware";
import { resourceLimitMiddleware } from "../../middleware";
import { baseResponses } from "../../shared/base-responses";
import { platformUrl } from "../../shared/platform-url";

const logger = createLogger("langwatch:api:scenarios");

const getService = () => ScenarioService.create(prisma);

const scenarioResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  situation: z.string(),
  criteria: z.array(z.string()),
  labels: z.array(z.string()),
});

const scenarioResponseWithPlatformUrlSchema = scenarioResponseSchema.extend({
  platformUrl: z.string().url(),
});

const createScenarioSchema = z.object({
  name: z.string().min(1, "name is required"),
  situation: z.string(),
  criteria: z.array(z.string()).optional().default([]),
  labels: z.array(z.string()).optional().default([]),
});

const updateScenarioSchema = z.object({
  name: z.string().min(1).optional(),
  situation: z.string().optional(),
  criteria: z.array(z.string()).optional(),
  labels: z.array(z.string()).optional(),
});

function toScenarioResponse(scenario: Scenario) {
  return {
    id: scenario.id,
    name: scenario.name,
    situation: scenario.situation,
    criteria: scenario.criteria,
    labels: scenario.labels,
  };
}

export function registerScenarioRoutes(
  secured: SecuredApp<{ Variables: AuthMiddlewareVariables }>,
): void {
  secured.access(requires("scenarios:view")).get(
  "/",
  describeRoute({
    description: "Get all scenarios for a project",
    responses: {
      ...baseResponses,
      200: {
        description: "Success",
        content: {
          "application/json": {
            schema: resolver(z.array(scenarioResponseWithPlatformUrlSchema)),
          },
        },
      },
    },
  }),
  async (c) => {
    const project = c.get("project");
    logger.info({ projectId: project.id }, "Listing scenarios");

    const service = getService();
    const scenarios = await service.getAll({ projectId: project.id });

    return c.json(scenarios.map((s) => ({
      ...toScenarioResponse(s),
      platformUrl: platformUrl({
        projectSlug: project.slug,
        path: `/simulations/scenarios?drawer.open=scenarioEditor&drawer.scenarioId=${s.id}`,
      }),
    })));
  },
);

  secured.access(requires("scenarios:view")).get(
  "/:id",
  describeRoute({
    description: "Get a specific scenario by ID",
    responses: {
      ...baseResponses,
      200: {
        description: "Success",
        content: {
          "application/json": {
            schema: resolver(scenarioResponseWithPlatformUrlSchema),
          },
        },
      },
      404: {
        description: "Scenario not found",
        content: {
          "application/json": { schema: resolver(badRequestSchema) },
        },
      },
    },
  }),
  async (c) => {
    const project = c.get("project");
    const { id } = c.req.param();
    logger.info({ projectId: project.id, scenarioId: id }, "Getting scenario");

    const service = getService();
    const scenario = await service.getById({ id, projectId: project.id });

    if (!scenario) {
      return c.json({ error: "Scenario not found" }, 404);
    }

    return c.json({
      ...toScenarioResponse(scenario),
      platformUrl: platformUrl({
        projectSlug: project.slug,
        path: `/simulations/scenarios?drawer.open=scenarioEditor&drawer.scenarioId=${scenario.id}`,
      }),
    });
  },
);

  // Creating asks for `scenarios:create`, not `scenarios:manage`.
  //
  // Nobody loses access: `:manage` implies `:create` through the RBAC
  // hierarchy, so every role and key that could create a scenario yesterday
  // still can. What changes is that access granted at the CREATE grain now
  // works — it used to be a permission the product would issue and then refuse
  // to honour, which is how an assistant scoped to exactly "read and create"
  // ended up unable to create anything. A viewer is unaffected: they keep the
  // read routes and are declined the write, as before.
  secured.access(requires("scenarios:create")).post(
  "/",
  resourceLimitMiddleware("scenarios"),
  describeRoute({
    description: "Create a new scenario",
    responses: {
      ...baseResponses,
      201: {
        description: "Scenario created",
        content: {
          "application/json": {
            schema: resolver(scenarioResponseWithPlatformUrlSchema),
          },
        },
      },
    },
  }),
  zValidator("json", createScenarioSchema),
  async (c) => {
    const project = c.get("project");
    const body = c.req.valid("json");

    logger.info({ projectId: project.id }, "Creating scenario");

    const service = getService();
    const scenario = await service.create({
      projectId: project.id,
      name: body.name,
      situation: body.situation,
      criteria: body.criteria,
      labels: body.labels,
    });

    return c.json({
      ...toScenarioResponse(scenario),
      platformUrl: platformUrl({
        projectSlug: project.slug,
        path: `/simulations/scenarios?drawer.open=scenarioEditor&drawer.scenarioId=${scenario.id}`,
      }),
    }, 201);
  },
);

  // `:update` for the same reason as `:create` above — `:manage` still implies
  // it, so no existing caller changes.
  secured.access(requires("scenarios:update")).put(
  "/:id",
  describeRoute({
    description: "Update an existing scenario",
    responses: {
      ...baseResponses,
      200: {
        description: "Scenario updated",
        content: {
          "application/json": {
            schema: resolver(scenarioResponseWithPlatformUrlSchema),
          },
        },
      },
      404: {
        description: "Scenario not found",
        content: {
          "application/json": { schema: resolver(badRequestSchema) },
        },
      },
    },
  }),
  zValidator("json", updateScenarioSchema),
  async (c) => {
    const project = c.get("project");
    const { id } = c.req.param();
    const body = c.req.valid("json");

    logger.info(
      { projectId: project.id, scenarioId: id },
      "Updating scenario",
    );

    const service = getService();
    const existing = await service.getById({ id, projectId: project.id });
    if (!existing) {
      return c.json({ error: "Scenario not found" }, 404);
    }

    const scenario = await service.update(id, project.id, {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.situation !== undefined && { situation: body.situation }),
      ...(body.criteria !== undefined && { criteria: body.criteria }),
      ...(body.labels !== undefined && { labels: body.labels }),
    });

    return c.json({
      ...toScenarioResponse(scenario),
      platformUrl: platformUrl({
        projectSlug: project.slug,
        path: `/simulations/scenarios?drawer.open=scenarioEditor&drawer.scenarioId=${scenario.id}`,
      }),
    });
  },
);

  // Archiving deliberately still asks for `:manage`. Create and update were
  // refined because access issued at that grain was being refused; nothing is
  // asking to destroy scenarios at a finer grain, and the destructive verb is
  // the wrong place to widen who qualifies.
  secured.access(requires("scenarios:manage")).delete(
  "/:id",
  describeRoute({
    description: "Archive (soft-delete) a scenario",
    responses: {
      ...baseResponses,
      200: {
        description: "Scenario archived",
        content: {
          "application/json": {
            schema: resolver(
              z.object({ id: z.string(), archived: z.boolean() }),
            ),
          },
        },
      },
      404: {
        description: "Scenario not found",
        content: {
          "application/json": { schema: resolver(badRequestSchema) },
        },
      },
    },
  }),
  async (c) => {
    const project = c.get("project");
    const { id } = c.req.param();

    logger.info(
      { projectId: project.id, scenarioId: id },
      "Archiving scenario",
    );

    const service = getService();
    try {
      await service.archive({ id, projectId: project.id });
      return c.json({ id, archived: true });
    } catch (error) {
      if (error instanceof ScenarioNotFoundError) {
        return c.json({ error: "Scenario not found" }, 404);
      }
      throw error;
    }
  },
);
}
