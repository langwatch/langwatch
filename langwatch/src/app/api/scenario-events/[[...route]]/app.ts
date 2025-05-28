import type { Project } from "@prisma/client";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { validator as zValidator, resolver } from "hono-openapi/zod";
import {
  authMiddleware,
  errorMiddleware,
  loggerMiddleware,
} from "../../middleware";
import { ScenarioRunnerService } from "./scenario-event.service";
import { scenarioEventSchema, responseSchemas } from "./schemas";

// Define types for our Hono context variables
type Variables = {
  project: Project;
};

// Define the Hono app
export const app = new Hono<{
  Variables: Variables;
}>().basePath("/api/scenario-events");

// Middleware
app.use(loggerMiddleware());
app.use("/*", errorMiddleware);
app.use("/*", authMiddleware);

// POST /api/scenario-events - Create a new scenario event
app.post(
  "/",
  describeRoute({
    description: "Create a new scenario event",
    responses: {
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

    const scenarioRunnerService = new ScenarioRunnerService();
    await scenarioRunnerService.saveScenarioEvent({
      projectId: project.id,
      ...event,
    });

    return c.json({ success: true }, 201);
  }
);

// GET /api/scenario-events/scenario-runs/:id - Get scenario run state
const getScenarioRunState = app.get(
  "/scenario-runs/state/:id",
  describeRoute({
    description: "Get scenario run state",
    responses: {
      200: {
        description: "Scenario run state retrieved successfully",
        content: {
          "application/json": { schema: resolver(responseSchemas.state) },
        },
      },
      404: {
        description: "Scenario run not found",
        content: {
          "application/json": { schema: resolver(responseSchemas.error) },
        },
      },
    },
  }),
  async (c) => {
    const { project } = c.var;
    const scenarioRunId = c.req.param("id");

    const scenarioRunnerService = new ScenarioRunnerService();
    const state = await scenarioRunnerService.getScenarioRunState({
      projectId: project.id,
      scenarioRunId,
    });

    if (!state) {
      return c.json({ error: "Scenario run not found" }, 404);
    }

    return c.json({ state });
  }
);

export type GetScenarioRunStateRouteType = typeof getScenarioRunState;

// GET /api/scenario-events/scenario-runs - Get all scenario runs
const getScenarioRunIdsRoute = app.get(
  "/scenario-runs/ids",
  describeRoute({
    description: "List all scenario runs",
    responses: {
      200: {
        description: "List of scenario runs retrieved successfully",
        content: {
          "application/json": { schema: resolver(responseSchemas.runs) },
        },
      },
    },
  }),
  async (c) => {
    const { project } = c.var;

    const scenarioRunnerService = new ScenarioRunnerService();
    const ids = await scenarioRunnerService.getScenarioRunIds({
      projectId: project.id,
    });

    return c.json({ ids });
  }
);

export type GetScenarioRunIdsRouteType = typeof getScenarioRunIdsRoute;

// GET /api/scenario-events - Get all events
app.get(
  "/",
  describeRoute({
    description: "List all events",
    responses: {
      200: {
        description: "List of events retrieved successfully",
        content: {
          "application/json": { schema: resolver(responseSchemas.events) },
        },
      },
    },
  }),
  async (c) => {
    const { project } = c.var;

    const scenarioRunnerService = new ScenarioRunnerService();
    const events = await scenarioRunnerService.getAllRunEventsForProject({
      projectId: project.id,
    });

    return c.json({ events });
  }
);

// DELETE /api/scenario-events - Delete all events for a project
export const route = app.delete(
  "/",
  describeRoute({
    description: "Delete all events",
    responses: {
      204: {
        description: "Events deleted successfully",
      },
    },
  }),
  async (c) => {
    const { project } = c.var;

    const scenarioRunnerService = new ScenarioRunnerService();
    await scenarioRunnerService.deleteAllEventsForProject({
      projectId: project.id,
    });

    return c.status(204);
  }
);

export type ScenarioEventsAppType = typeof route;
