import type { Project } from "@prisma/client";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { resolver, validator as zValidator } from "hono-openapi/zod";
import { getApp } from "~/server/app-layer/app";
import { getClickHouseClient } from "~/server/clickhouse/client";
import { ScenarioEventType } from "~/server/scenarios/scenario-event.enums";
import { ScenarioEventService } from "~/server/scenarios/scenario-event.service";
import type { ScenarioEvent } from "~/server/scenarios/scenario-event.types";
import { responseSchemas, scenarioEventSchema } from "~/server/scenarios/schemas";
import { ClickHouseSimulationService } from "~/server/simulations/clickhouse-simulation.service";
import { createLogger } from "~/utils/logger/server";
import {
  authMiddleware,
  blockTraceUsageExceededMiddleware,
  handleError,
  loggerMiddleware,
  tracerMiddleware,
} from "../../middleware";
import { baseResponses } from "../../shared/base-responses";

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
app.use("/*", blockTraceUsageExceededMiddleware);
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
        eventType: event.type,
        scenarioId: event.scenarioId,
        scenarioRunId: event.scenarioRunId,
        scenarioSetId: event.scenarioSetId,
      },
      "Received scenario event",
    );


    // Dual-write to ClickHouse via event-sourcing (fire-and-forget)
    if (project.featureEventSourcingSimulationIngestion) {
      await dispatchSimulationEvent(project.id, event);
    }

    // const scenarioRunnerService = new ScenarioEventService();
    // await scenarioRunnerService.saveScenarioEvent({
    //   projectId: project.id,
    //   ...event,
    // });

    const path = `/${project.slug}/simulations/${
      event.scenarioSetId ?? "default"
    }`;

    const base = process.env.BASE_HOST;

    if (!base) {
      logger.error(
        "BASE_HOST is not set, but required for scenario event url payload",
      );

      return c.json({ success: false }, 500);
    }

    const url = `${base}${path}`;

    return c.json({ success: true, url }, 201);
  },
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

    // Also soft-delete in CH (fire-and-forget)
    if (project.featureEventSourcingSimulationIngestion) {
      void softDeleteSimulationRunsInClickHouse(project.id);
    }

    return c.json({ success: true }, 200);
  },
);

export type ScenarioEventsAppType = typeof route;

async function dispatchSimulationEvent(
  projectId: string,
  event: ScenarioEvent,
): Promise<void> {
  try {
    const basePayload = {
      tenantId: projectId,
      scenarioRunId: event.scenarioRunId,
      occurredAt: event.timestamp ?? Date.now(),
    };

    if (event.type === ScenarioEventType.RUN_STARTED) {
      await getApp().simulations.startRun({
        ...basePayload,
        scenarioId: event.scenarioId,
        batchRunId: event.batchRunId,
        scenarioSetId: event.scenarioSetId ?? "default",
        name: event.metadata?.name,
        description: event.metadata?.description,
      });
    } else if (event.type === ScenarioEventType.MESSAGE_SNAPSHOT) {
      const messages = event.messages ?? [];
      await getApp().simulations.messageSnapshot({
        ...basePayload,
        messages: messages as Array<{ trace_id?: string; [key: string]: unknown }>,
        traceIds: messages
          .map((m: { trace_id?: string }) => m.trace_id)
          .filter((id): id is string => typeof id === "string"),
      });
    } else if (event.type === ScenarioEventType.RUN_FINISHED) {
      await getApp().simulations.finishRun({
        ...basePayload,
        results: event.results
          ? {
              verdict: event.results.verdict,
              reasoning: event.results.reasoning,
              metCriteria: event.results.metCriteria,
              unmetCriteria: event.results.unmetCriteria,
              error: event.results.error,
            }
          : undefined,
        status: event.status,
      });
    }
  } catch (err) {
    logger.warn({ err, projectId }, "Failed to dispatch simulation event to CH");
  }
}

async function softDeleteSimulationRunsInClickHouse(
  projectId: string,
): Promise<void> {
  try {
    const chService = ClickHouseSimulationService.create(getClickHouseClient());
    if (chService) {
      await chService.softDeleteAllForProject({ projectId });
    }
  } catch (err) {
    logger.warn(
      { err, projectId },
      "Failed to soft-delete simulation runs in ClickHouse",
    );
  }
}
