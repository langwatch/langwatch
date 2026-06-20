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

// DELETE /api/scenario-events - Archive all simulation runs for a scenario
// set. A scenarioSetId is MANDATORY: an unqualified request is rejected so a
// single call can never archive every run in the project.
export const route = secured.access(requires("scenarios:manage")).delete(
  "/",
  blockTraceUsageExceededMiddleware,
  describeRoute({
    description:
      "Archive all simulation runs for a scenario set. Pass `scenarioSetId=default` to archive runs in the implicit default set; future SDK runs without an explicit setId will repopulate it.",
    responses: {
      ...baseResponses,
      200: {
        description: "Runs archived successfully",
        content: {
          "application/json": { schema: resolver(responseSchemas.archive) },
        },
      },
      400: {
        description: "Missing or invalid scenarioSetId",
        content: {
          "application/json": { schema: resolver(responseSchemas.error) },
        },
      },
    },
  }),
  zValidator(
    "query",
    z.object({
      scenarioSetId: z
        .string()
        .min(1, "scenarioSetId query parameter is required"),
    }),
  ),
  async (c) => {
    const { project } = c.var;
    const { scenarioSetId } = c.req.valid("query");

    const result = await archiveScenarioSetRuns({
      projectId: project.id,
      scenarioSetId,
    });

    return c.json(result, 200);
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

/**
 * Archives every active run in a scenario set by dispatching a deleteRun
 * command per run id. Exported as a test seam.
 *
 * Dispatch is bounded-concurrency (not an unbounded `Promise.all`) and
 * failure-collecting: one rejected deleteRun never short-circuits the rest;
 * the failure is counted and logged. The returned `hasMore` reflects whether
 * the run-id lookup hit its cap, i.e. more runs may remain to archive.
 */
export async function archiveScenarioSetRuns({
  projectId,
  scenarioSetId,
}: {
  projectId: string;
  scenarioSetId: string;
}): Promise<{
  archived: number;
  failed: number;
  scenarioSetId: string;
  hasMore: boolean;
}> {
  const { runIds, reachedCap } =
    await getApp().simulations.runs.getRunIdsForSet({
      projectId,
      scenarioSetId,
    });

  const now = Date.now();
  let archived = 0;
  let failed = 0;

  await pMapLimited({
    items: runIds,
    concurrency: 8,
    fn: async (id) => {
      try {
        await getApp().simulations.deleteRun({
          tenantId: projectId,
          scenarioRunId: id,
          occurredAt: now,
        });
        archived++;
      } catch (err) {
        failed++;
        logger.warn(
          { projectId, scenarioRunId: id, err },
          "Failed to dispatch deleteRun",
        );
      }
    },
  });

  return { archived, failed, scenarioSetId, hasMore: reachedCap };
}

/**
 * Maps `fn` over `items` with at most `concurrency` invocations in flight at
 * once, awaiting the next free slot before starting the following item.
 */
async function pMapLimited<T>({
  items,
  fn,
  concurrency,
}: {
  items: T[];
  fn: (item: T) => Promise<void>;
  concurrency: number;
}): Promise<void> {
  const executing = new Set<Promise<void>>();
  for (const item of items) {
    const p = fn(item).then(() => {
      executing.delete(p);
    });
    executing.add(p);
    if (executing.size >= concurrency) await Promise.race(executing);
  }
  await Promise.all(executing);
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
