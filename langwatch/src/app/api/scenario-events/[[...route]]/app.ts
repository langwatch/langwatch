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
import {
  scenarioEventSchema,
  responseSchemas,
  scenarioRunFinishedSchema,
} from "./schemas";
import { z } from "zod";

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
const getScenarioRunData = app.get(
  "/scenario-runs/state/:id",
  describeRoute({
    description: "Get scenario run state",
    responses: {
      200: {
        description: "Scenario run state retrieved successfully",
        content: {
          "application/json": { schema: resolver(responseSchemas.runData) },
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
    const data = await scenarioRunnerService.getScenarioRunData({
      projectId: project.id,
      scenarioRunId,
    });

    if (!data) {
      return c.json({ error: "Scenario run not found" }, 404);
    }

    return c.json(data);
  }
);

export type GetScenarioRunStateRouteType = typeof getScenarioRunData;

// GET /api/scenario-events/scenario-runs/:id/history - Get scenario run history
const getScenarioRunFinishedEventsByScenarioIdRoute = app.get(
  "/scenario-runs/finished-events/:id",
  describeRoute({
    description: "Get scenario run history",
    responses: {
      200: {
        description: "Scenario run history retrieved successfully",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                results: z.array(scenarioRunFinishedSchema),
              })
            ),
          },
        },
      },
    },
  }),
  async (c) => {
    const { project } = c.var;
    const scenarioId = c.req.param("id");

    const scenarioRunnerService = new ScenarioRunnerService();
    const { results } = await scenarioRunnerService.getScenarioResultsHistory({
      projectId: project.id,
      scenarioId,
    });

    return c.json({ results });
  }
);

export type GetScenarioRunFinishedEventsByScenarioIdRouteType =
  typeof getScenarioRunFinishedEventsByScenarioIdRoute;

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

// GET /api/scenario-events/batch-runs - Get all batch runs
const getBatchRunIdsRoute = app.get(
  "/batch-runs/ids",
  describeRoute({
    description: "List all batch runs with scenario counts",
    responses: {
      200: {
        description: "List of batch runs retrieved successfully",
        content: {
          "application/json": { schema: resolver(responseSchemas.batches) },
        },
      },
    },
  }),
  async (c) => {
    const { project } = c.var;

    const scenarioRunnerService = new ScenarioRunnerService();
    const batches = await scenarioRunnerService.getAllBatchRunsForProject({
      projectId: project.id,
    });

    return c.json({ batches });
  }
);

export type GetBatchRunIdsRouteType = typeof getBatchRunIdsRoute;

// GET /api/scenario-events/batch-runs/:id/scenario-runs - Get scenario runs for a batch
const getScenarioRunsForBatchRoute = app.get(
  "/batch-runs/:id/scenario-runs",
  describeRoute({
    description: "List scenario runs for a specific batch",
    responses: {
      200: {
        description: "List of scenario runs for batch retrieved successfully",
        content: {
          "application/json": { schema: resolver(responseSchemas.runs) },
        },
      },
    },
  }),
  async (c) => {
    const { project } = c.var;
    const batchRunId = c.req.param("id");

    const scenarioRunnerService = new ScenarioRunnerService();
    const ids = await scenarioRunnerService.getScenarioRunsForBatch({
      projectId: project.id,
      batchRunId,
    });

    return c.json({ ids });
  }
);

export type GetScenarioRunsForBatchRouteType =
  typeof getScenarioRunsForBatchRoute;

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

    const scenarioRunnerService = new ScenarioRunnerService();
    await scenarioRunnerService.deleteAllEventsForProject({
      projectId: project.id,
    });

    return c.json({ success: true }, 200);
  }
);

export type ScenarioEventsAppType = typeof route;
