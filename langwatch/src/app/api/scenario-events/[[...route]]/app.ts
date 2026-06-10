import { bodyLimit } from "hono/body-limit";
import { describeRoute } from "hono-openapi";
import { resolver, validator as zValidator } from "hono-openapi/zod";
import { z } from "zod";
import { createProjectApp, requires } from "~/server/api/security";
import { getApp } from "~/server/app-layer/app";
import { DEFAULT_SET_ID } from "~/server/scenarios/internal-set-id";
import { ScenarioEventType } from "~/server/scenarios/scenario-event.enums";
import type { ScenarioEvent } from "~/server/scenarios/scenario-event.types";
import {
  responseSchemas,
  scenarioEventSchema,
} from "~/server/scenarios/schemas";
import { extractInlineMediaFromEvent } from "~/server/stored-objects/content-extractor";
import { createStoredObjectsService } from "~/server/stored-objects/stored-objects-factory";
import { createLogger } from "~/utils/logger/server";
import {
  encodeContent,
  encodeEnd,
  encodeStart,
} from "~/utils/streaming-event-codec";
import { blockTraceUsageExceededMiddleware } from "../../middleware";
import { baseResponses } from "../../shared/base-responses";
import { checkScenarioSetLimitForRunStarted } from "./scenario-set-limit";

const logger = createLogger("langwatch:api:scenario-events");

const secured = createProjectApp({ basePath: "/api/scenario-events" });

// POST /api/scenario-events - Create a new scenario event
secured.access(requires("scenarios:manage")).post(
  "/",
  blockTraceUsageExceededMiddleware,
  bodyLimit({ maxSize: 50 * 1024 * 1024 }), // 50MB — accommodates inline media payloads
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
    const validatedEvent = c.req.valid("json");

    logger.info(
      {
        projectId: project.id,
        eventType: validatedEvent.type,
        scenarioId: validatedEvent.scenarioId,
        scenarioRunId: validatedEvent.scenarioRunId,
        scenarioSetId: validatedEvent.scenarioSetId,
      },
      "Received scenario event",
    );

    // Extract inline media bytes, externalize to stored objects, and rewrite
    // the event payload to reference them by URL before dispatch.
    const service = createStoredObjectsService({ projectId: project.id });
    const { rewrittenEvent: rawRewritten, refs } =
      await extractInlineMediaFromEvent({
        event: validatedEvent,
        projectId: project.id,
        ownerKind: "scenario_run",
        ownerId: validatedEvent.scenarioRunId,
        purpose: "scenario_event",
        service,
      });

    // Cast back to the typed ScenarioEvent — the rewrite only touches content
    // arrays inside message objects; all discriminant fields are preserved.
    const event = rawRewritten as ScenarioEvent;

    if (refs.length > 0) {
      logger.info(
        {
          stored_object_ids: refs.map((r) => r.id),
          projectId: project.id,
          scenarioRunId: validatedEvent.scenarioRunId,
          count: refs.length,
        },
        `scenario event extracted ${refs.length} stored object(s)`,
      );
    }

    // Enforce scenario set limit on RUN_STARTED events.
    // ScenarioSetLimitExceededError (DomainError with httpStatus 403)
    // propagates to handleError which returns 403 + meta fields.
    await checkScenarioSetLimitForRunStarted({ project, event });
    await dispatchSimulationEvent(project.id, event);

    // Streaming events: broadcast only, no persistence
    if (isStreamingEvent(event.type)) {
      await broadcastStreamingEvent(project.id, event);
      return c.json({ success: true }, 201);
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

    const path = `/${project.slug}/simulations/${
      event.scenarioSetId || DEFAULT_SET_ID
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

// DELETE /api/scenario-events - Archive the simulation runs for a specific
// batch run and/or scenario set. A scope is MANDATORY: an unqualified request
// is rejected so a single call can never archive every run in the project.
const deleteScenarioEventsQuerySchema = z.object({
  batchRunId: z.string().min(1).optional(),
  scenarioSetId: z.string().min(1).optional(),
});

export const route = secured.access(requires("scenarios:manage")).delete(
  "/",
  blockTraceUsageExceededMiddleware,
  describeRoute({
    description:
      "Archive the simulation runs for a batch run and/or scenario set. Requires at least one of batchRunId or scenarioSetId — archiving every run in the project in one call is not supported.",
    responses: {
      ...baseResponses,
      200: {
        description: "Matching runs archived successfully",
        content: {
          "application/json": { schema: resolver(responseSchemas.success) },
        },
      },
      400: {
        description:
          "No scope provided — a batchRunId or scenarioSetId is required",
        content: {
          "application/json": { schema: resolver(responseSchemas.error) },
        },
      },
    },
  }),
  zValidator("query", deleteScenarioEventsQuerySchema),
  async (c) => {
    const { project } = c.var;
    const { batchRunId, scenarioSetId } = c.req.valid("query");

    if (!batchRunId && !scenarioSetId) {
      return c.json(
        {
          error:
            "A batchRunId or scenarioSetId must be specified. Archiving every simulation run for the project in one request is not supported.",
        },
        400,
      );
    }

    await archiveSimulationRunsForScope({
      projectId: project.id,
      batchRunId,
      scenarioSetId,
    });

    return c.json({ success: true }, 200);
  },
);

export type ScenarioEventsAppType = typeof route;

export const app = secured.hono;

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
      scenarioSetId: event.scenarioSetId || DEFAULT_SET_ID,
      name: event.metadata?.name,
      description: event.metadata?.description,
      metadata: event.metadata,
    });
  } else if (event.type === ScenarioEventType.MESSAGE_SNAPSHOT) {
    const messages = event.messages ?? [];
    await getApp().simulations.messageSnapshot({
      ...basePayload,
      messages: messages as Array<{
        trace_id?: string;
        [key: string]: unknown;
      }>,
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

/** Streaming events are broadcast-only, not persisted via event-sourcing */
function isStreamingEvent(type: string): boolean {
  return (
    type === ScenarioEventType.TEXT_MESSAGE_CONTENT ||
    type === ScenarioEventType.TOOL_CALL_START ||
    type === ScenarioEventType.TOOL_CALL_ARGS ||
    type === ScenarioEventType.TOOL_CALL_END
  );
}

async function archiveSimulationRunsForScope({
  projectId,
  batchRunId,
  scenarioSetId,
}: {
  projectId: string;
  batchRunId?: string;
  scenarioSetId?: string;
}): Promise<void> {
  const app = getApp();
  const runIds = await app.simulations.runs.getRunIdsForScope({
    projectId,
    batchRunId,
    scenarioSetId,
  });

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

  logger.info(
    { projectId, batchRunId, scenarioSetId, count: runIds.length },
    "Dispatched archive commands for scoped simulation runs",
  );
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
