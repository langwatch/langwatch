import type { Scenario } from "@prisma/client";
import { describeRoute } from "hono-openapi";
import { resolver, validator as zValidator } from "hono-openapi/zod";
import { Hono } from "hono";
import { z } from "zod";
import { badRequestSchema } from "~/app/api/shared/schemas";
import { prisma } from "~/server/db";
import { ScenarioNotFoundError } from "~/server/scenarios/errors";
import { ScenarioService } from "~/server/scenarios/scenario.service";
import { createLogger } from "~/utils/logger/server";
import {
  type AuthMiddlewareVariables,
  resourceLimitMiddleware,
} from "../../middleware";
import { baseResponses } from "../../shared/base-responses";
import { platformUrl } from "../../shared/platform-url";

const logger = createLogger("langwatch:api:scenarios");

type Variables = AuthMiddlewareVariables;

export const app = new Hono<{ Variables: Variables }>().basePath("/");

const getService = () => ScenarioService.create(prisma);

const scenarioResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  situation: z.string(),
  criteria: z.array(z.string()),
  labels: z.array(z.string()),
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

app.get(
  "/",
  describeRoute({
    description: "Get all scenarios for a project",
    responses: {
      ...baseResponses,
      200: {
        description: "Success",
        content: {
          "application/json": {
            schema: resolver(z.array(scenarioResponseSchema)),
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
        path: `/simulations/scenarios`,
      }),
    })));
  },
);

app.get(
  "/:id",
  describeRoute({
    description: "Get a specific scenario by ID",
    responses: {
      ...baseResponses,
      200: {
        description: "Success",
        content: {
          "application/json": {
            schema: resolver(scenarioResponseSchema),
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
        path: `/simulations/scenarios`,
      }),
    });
  },
);

app.post(
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
            schema: resolver(scenarioResponseSchema),
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
        path: `/simulations/scenarios`,
      }),
    }, 201);
  },
);

app.put(
  "/:id",
  describeRoute({
    description: "Update an existing scenario",
    responses: {
      ...baseResponses,
      200: {
        description: "Scenario updated",
        content: {
          "application/json": {
            schema: resolver(scenarioResponseSchema),
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
        path: `/simulations/scenarios`,
      }),
    });
  },
);

app.delete(
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
