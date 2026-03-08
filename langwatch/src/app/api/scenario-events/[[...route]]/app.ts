import type { Project } from "@prisma/client";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { resolver, validator as zValidator } from "hono-openapi/zod";
import { getApp } from "~/server/app-layer/app";
import { ScenarioEventType } from "~/server/scenarios/scenario-event.enums";
import { ScenarioEventService } from "~/server/scenarios/scenario-event.service";
import type { ScenarioEvent } from "~/server/scenarios/scenario-event.types";
import { responseSchemas, scenarioEventSchema } from "~/server/scenarios/schemas";
import { createLogger } from "~/utils/logger/server";
import {
  encodeContent,
  encodeEnd,
  encodeStart,
} from "~/utils/streaming-event-codec";
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


    // Streaming events: broadcast only, no persistence
    if (isStreamingEvent(event.type)) {
      await broadcastStreamingEvent(project.id, event);
      return c.json({ success: true }, 201);
    }

    // Event-sourcing write to ClickHouse (primary)
    if (project.featureEventSourcingSimulationIngestion) {
      await dispatchSimulationEvent(project.id, event);
    }

    // Broadcast START/END directly so the frontend gets them immediately
    // (the reactor's debounced broadcast is too slow and causes CONTENT
    // deltas to be dropped). Works regardless of event-sourcing flag.
    if (
      event.type === ScenarioEventType.TEXT_MESSAGE_START ||
      event.type === ScenarioEventType.TEXT_MESSAGE_END
    ) {
      await broadcastStreamingEvent(project.id, event);
    }

    // Legacy ES write (best-effort, will be removed)
    if (!project.disableElasticSearchSimulationWriting) {
      try {
        const scenarioRunnerService = new ScenarioEventService();
        await scenarioRunnerService.saveScenarioEvent({
          projectId: project.id,
          ...event,
        });
      } catch (err) {
        logger.warn({ err, projectId: project.id }, "Failed to write scenario event to ES (best-effort)");
      }
    }

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

    // Event-sourcing archive (primary)
    if (project.featureEventSourcingSimulationIngestion) {
      await archiveAllSimulationRuns(project.id);
    }

    // Legacy ES delete (best-effort, will be removed)
    if (!project.disableElasticSearchSimulationWriting) {
      try {
        const scenarioRunnerService = new ScenarioEventService();
        await scenarioRunnerService.deleteAllEventsForProject({
          projectId: project.id,
        });
      } catch (err) {
        logger.warn({ err, projectId: project.id }, "Failed to delete events from ES (best-effort)");
      }
    }

    return c.json({ success: true }, 200);
  },
);

export type ScenarioEventsAppType = typeof route;

async function dispatchSimulationEvent(
  projectId: string,
  event: ScenarioEvent,
): Promise<void> {
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
  } else if (event.type === ScenarioEventType.TEXT_MESSAGE_START) {
    await getApp().simulations.textMessageStart({
      ...basePayload,
      messageId: event.messageId,
      role: event.role,
      messageIndex: event.messageIndex,
    });
  } else if (event.type === ScenarioEventType.TEXT_MESSAGE_END) {
    await getApp().simulations.textMessageEnd({
      ...basePayload,
      messageId: event.messageId,
      role: event.role,
      content: event.content ?? "",
      message: event.message,
      traceId: event.traceId,
      messageIndex: event.messageIndex,
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
}

/** Event types that exist in the legacy ES path */
function isLegacyEvent(type: string): boolean {
  return (
    type === ScenarioEventType.RUN_STARTED ||
    type === ScenarioEventType.RUN_FINISHED ||
    type === ScenarioEventType.MESSAGE_SNAPSHOT
  );
}

/** Streaming events are broadcast-only, not persisted via event-sourcing */
function isStreamingEvent(type: string): boolean {
  return (
    type === ScenarioEventType.TEXT_MESSAGE_CONTENT ||
    type === ScenarioEventType.TOOL_CALL_START ||
    type === ScenarioEventType.TOOL_CALL_ARGS ||
    type === ScenarioEventType.TOOL_CALL_END
  );
}

async function archiveAllSimulationRuns(projectId: string): Promise<void> {
  const app = getApp();
  const runIds = await app.simulations.runs.getAllRunIdsForProject({ projectId });

  const now = Date.now();
  await Promise.all(
    runIds.map((scenarioRunId) =>
      getApp().simulations.deleteRun({
        tenantId: projectId,
        scenarioRunId,
        occurredAt: now,
      }),
    ),
  );

  logger.info({ projectId, count: runIds.length }, "Dispatched archive commands for all simulation runs");
}

async function broadcastStreamingEvent(
  projectId: string,
  event: ScenarioEvent,
): Promise<void> {
  try {
    let payload: string;

    if (event.type === ScenarioEventType.TEXT_MESSAGE_START) {
      payload = encodeStart({
        scenarioRunId: event.scenarioRunId,
        batchRunId: event.batchRunId,
        messageId: event.messageId,
        role: event.role,
        messageIndex: event.messageIndex,
      });
    } else if (event.type === ScenarioEventType.TEXT_MESSAGE_CONTENT) {
      payload = encodeContent({
        scenarioRunId: event.scenarioRunId,
        batchRunId: event.batchRunId,
        messageId: event.messageId,
        delta: event.delta,
      });
    } else if (event.type === ScenarioEventType.TEXT_MESSAGE_END) {
      payload = encodeEnd({
        scenarioRunId: event.scenarioRunId,
        batchRunId: event.batchRunId,
        messageId: event.messageId,
        content: event.content,
      });
    } else {
      // Tool call events — full payload for now
      payload = JSON.stringify({
        e: event.type,
        r: event.scenarioRunId,
        b: event.batchRunId,
      });
    }

    const tier =
      event.type === ScenarioEventType.TEXT_MESSAGE_CONTENT ||
      event.type === ScenarioEventType.TOOL_CALL_ARGS
        ? ("delta" as const)
        : ("structural" as const);

    await getApp().broadcast.broadcastToTenantRateLimited(
      projectId,
      payload,
      "simulation_updated",
      tier,
    );
  } catch (err) {
    logger.warn({ err, projectId }, "Failed to broadcast streaming event");
  }
}
