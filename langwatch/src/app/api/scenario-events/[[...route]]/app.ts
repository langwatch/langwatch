import type { Project } from "@prisma/client";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { validator as zValidator, resolver } from "hono-openapi/zod";

import {
  authMiddleware,
  handleError,
  tracerMiddleware,
  loggerMiddleware,
} from "../../middleware";
import { baseResponses } from "../../shared/base-responses";

import { ScenarioEventService } from "./scenario-event.service";
import { scenarioEventSchema, responseSchemas } from "./schemas";

import { createLogger } from "~/utils/logger";
import z from "zod";

const logger = createLogger("langwatch:api:scenario-events");

// Define types for our Hono context variables
type Variables = {
  project: Project;
};

// Define the Hono app
export const app = new Hono<{
  Variables: Variables;
}>().basePath("/api/scenario-events");

// Middleware
app.use(tracerMiddleware({ name: "scenario-events" }));
app.use(loggerMiddleware());
app.use("/*", authMiddleware);
app.onError(handleError);

// POST /api/scenario-events - Create a new scenario event
app.post(
  "/",
  describeRoute({
    description: "Create a new scenario event",
    responses: {
      ...baseResponses,
      201: {
        description: "Event created successfully",
        content: {
          "application/json": { schema: resolver(responseSchemas.success) },
        },
      },
      400: {
        description: "Invalid event data",
        content: {
          "application/json": { schema: resolver(responseSchemas.error) },
        },
      },
    },
  }),
  zValidator("json", scenarioEventSchema),
  async (c) => {
    const { project } = c.var;
    const event = c.req.valid("json");

    logger.info(
      {
        projectId: project.id,
        type: (event as any)?.type,
        scenarioId: (event as any)?.scenarioId,
        scenarioRunId: (event as any)?.scenarioRunId,
        scenarioSetId: (event as any)?.scenarioSetId,
        batchRunId: (event as any)?.batchRunId,
        timestamp: (event as any)?.timestamp ?? Date.now(),
      },
      "scenario-event:create"
    );

    const scenarioRunnerService = new ScenarioEventService();
    await scenarioRunnerService.saveScenarioEvent({
      projectId: project.id,
      ...event,
    });

    const path = `/${project.slug}/simulations/${
      event.scenarioSetId ?? "default"
    }`;

    const base = process.env.BASE_HOST;

    if (!base) {
      logger.error(
        {
          projectId: project.id,
          path,
          scenarioSetId: (event as any)?.scenarioSetId,
        },
        "BASE_HOST is not set, but required for scenario event url payload"
      );

      return c.json({ success: false }, 500);
    }

    const url = `${base}${path}`;

    return c.json({ success: true, url }, 201);
  }
);

// DELETE /api/scenario-events - Delete all events for a project
export const route = app.delete(
  "/",
  describeRoute({
    description: "Delete all events",
    responses: {
      ...baseResponses,
      200: {
        description: "Events deleted successfully",
        content: {
          "application/json": { schema: resolver(responseSchemas.success) },
        },
      },
    },
  }),
  async (c) => {
    const { project } = c.var;

    const scenarioRunnerService = new ScenarioEventService();
    await scenarioRunnerService.deleteAllEventsForProject({
      projectId: project.id,
    });

    return c.json({ success: true }, 200);
  }
);

export type ScenarioEventsAppType = typeof route;
