import { createLogger } from "@langwatch/observability";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import { createProjectApp } from "~/server/api/security";
import {
  baseResponses,
  requires,
  validator as zValidator,
} from "@langwatch/platform-api/app-rest";
import type { App } from "~/server/app-layer/app";
import { bodyLimit } from "~/server/routes/_lib/body-limit";
import {
  SCENARIO_TAB_NAVIGATE_EVENT,
  type ScenarioTabNavigatePayload,
} from "@langwatch/scenario-contract";
import { DEFAULT_SET_ID } from "@langwatch/scenario-contract";
import { ScenarioEventType } from "@langwatch/scenario-contract";
import type { ScenarioEvent } from "@langwatch/scenario-contract";
import { responseSchemas, scenarioEventSchema } from "@langwatch/scenario-contract";
import { extractInlineMediaFromEvent } from "~/server/stored-objects/content-extractor";
import { encodeContent, encodeEnd, encodeStart } from "~/utils/streaming-event-codec";
import { blockTraceUsageExceededMiddleware } from "../../middleware";

const logger = createLogger("langwatch:api:scenario-events");

const secured = createProjectApp({ basePath: "/api/scenario-events" });

// POST /api/scenario-events - Create a new scenario event
//
// Reporting a scenario event creates run data; it never touches a scenario
// definition, so it asks for `scenarios:create` rather than the administration
// grain. `:manage` still implies `:create` through the RBAC hierarchy, so every
// SDK key and role that could report events yesterday still can; a viewer holds
// only `scenarios:view` and is declined exactly as before.
secured.access(requires("scenarios:create")).post(
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
    const { rewrittenEvent: rawRewritten, refs } = await extractInlineMediaFromEvent({
      event: validatedEvent,
      projectId: project.id,
      ownerKind: "scenario_run",
      ownerId: validatedEvent.scenarioRunId,
      purpose: "scenario_event",
      service: c.app.storedObjects,
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

    await dispatchSimulationEvent(c.app, project.id, event);

    // Streaming events: broadcast only, no persistence
    if (isStreamingEvent(event.type)) {
      await broadcastStreamingEvent(c.app, project.id, event);
      return c.json({ success: true }, 201);
    }

    // Broadcast START/END directly so the frontend gets them immediately
    // (the subscriber's debounced broadcast is too slow and causes CONTENT
    // deltas to be dropped). Works regardless of event-sourcing flag.
    if (
      event.type === ScenarioEventType.TEXT_MESSAGE_START ||
      event.type === ScenarioEventType.TEXT_MESSAGE_END
    ) {
      await broadcastStreamingEvent(c.app, project.id, event);
    }

    const path = `/${project.slug}/simulations/${event.scenarioSetId || DEFAULT_SET_ID}`;

    const base = process.env.BASE_HOST;

    if (!base) {
      logger.error("BASE_HOST is not set, but required for scenario event url payload");

      return c.json({ success: false }, 500);
    }

    const url = `${base}${path}`;

    return c.json({ success: true, url }, 201);
  },
);

// POST /api/scenario-events/browser-tab - Offer a batch run to a simulations
// tab that is already open on the caller's machine.
//
// The SDK sends the scenario tab key it stamped on the tab it opened earlier.
// When a tab holding that key still has a live SSE subscription, the run is
// broadcast to it and the SDK skips opening a browser; otherwise the SDK falls
// back to opening one. Reporting a run is `scenarios:create` work, and so is
// steering where that run is displayed.
secured.access(requires("scenarios:create")).post(
  "/browser-tab",
  describeRoute({
    description:
      "Offer a batch run to an already-open simulations tab on the caller's machine. Returns whether a live tab took it.",
    responses: {
      ...baseResponses,
      200: {
        description: "Handoff evaluated",
        content: {
          "application/json": {
            schema: resolver(responseSchemas.browserTabHandoff),
          },
        },
      },
    },
  }),
  zValidator(
    "json",
    z.object({
      tabKey: z.string().min(1).max(200),
      batchRunId: z.string().min(1).max(200),
      scenarioSetId: z.string().min(1).max(200).optional(),
    }),
  ),
  async (c) => {
    const { project } = c.var;
    const { tabKey, batchRunId, scenarioSetId } = c.req.valid("json");

    const base = process.env.BASE_HOST;

    if (!base) {
      logger.error(
        "BASE_HOST is not set, but required for the scenario browser-tab handoff",
      );

      return c.json({ error: "BASE_HOST is not configured" }, 500);
    }

    // Built server-side from ids rather than accepted as a URL: a handoff can
    // only ever point a browser at this instance's own simulations page. The
    // ids are caller-supplied and only length-bounded, so they are encoded — a
    // `#` or `?` in one would otherwise truncate the rest of the path.
    const url = `${base}/${project.slug}/simulations/${encodeURIComponent(
      scenarioSetId || DEFAULT_SET_ID,
    )}/${encodeURIComponent(batchRunId)}`;

    const hasLiveTab = await c.app.scenarioTabs.hasLiveTab({
      projectId: project.id,
      tabKey,
    });

    if (!hasLiveTab) {
      return c.json({ delivered: false, url }, 200);
    }

    const payload: ScenarioTabNavigatePayload = {
      event: SCENARIO_TAB_NAVIGATE_EVENT,
      tabKey,
      url,
    };

    // Parked before the broadcast so a tab reconnecting right now cannot slip
    // between the two and miss a run we already reported as delivered.
    await c.app.scenarioTabs.setPendingNavigate({
      projectId: project.id,
      tabKey,
      url,
    });

    await c.app.broadcast.broadcastToTenant(
      project.id,
      JSON.stringify(payload),
      "simulation_updated",
    );

    logger.info(
      { projectId: project.id, batchRunId },
      "Handed scenario batch to an open simulations tab",
    );

    return c.json({ delivered: true, url }, 200);
  },
);

// DELETE /api/scenario-events - Archive all simulation runs for a scenario
// set. A scenarioSetId is MANDATORY: an unqualified request is rejected so a
// single call can never archive every run in the project. Stays at `:manage`:
// it is bulk destruction, and only the administration grain should carry it.
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
      scenarioSetId: z.string().min(1, "scenarioSetId query parameter is required"),
    }),
  ),
  async (c) => {
    const { project } = c.var;
    const { scenarioSetId } = c.req.valid("query");

    const result = await archiveScenarioSetRuns({
      app: c.app,
      projectId: project.id,
      scenarioSetId,
    });

    return c.json(result, 200);
  },
);

export type ScenarioEventsAppType = typeof route;

export const app = secured.hono;

async function dispatchSimulationEvent(
  app: App,
  projectId: string,
  event: ScenarioEvent,
): Promise<void> {
  const basePayload = {
    tenantId: projectId,
    scenarioRunId: event.scenarioRunId,
    occurredAt: event.timestamp ?? Date.now(),
  };

  if (event.type === ScenarioEventType.RUN_STARTED) {
    await app.simulations.startRun({
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
    await app.simulations.messageSnapshot({
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
    await app.simulations.textMessageStart({
      ...basePayload,
      messageId: event.messageId,
      role: event.role,
      messageIndex: event.messageIndex,
    });
  } else if (event.type === ScenarioEventType.TEXT_MESSAGE_END) {
    await app.simulations.textMessageEnd({
      ...basePayload,
      messageId: event.messageId,
      role: event.role,
      content: event.content ?? "",
      message: event.message,
      traceId: event.traceId,
      messageIndex: event.messageIndex,
    });
  } else if (event.type === ScenarioEventType.RUN_FINISHED) {
    await app.simulations.finishRun({
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
  app,
  projectId,
  scenarioSetId,
}: {
  app: Pick<App, "simulations">;
  projectId: string;
  scenarioSetId: string;
}): Promise<{
  archived: number;
  failed: number;
  scenarioSetId: string;
  hasMore: boolean;
}> {
  const { runIds, reachedCap } = await app.simulations.getRunIdsForSet({
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
        await app.simulations.deleteRun({
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
    const p = fn(item).finally(() => {
      executing.delete(p);
    });
    executing.add(p);
    if (executing.size >= concurrency) await Promise.race(executing);
  }
  await Promise.all(executing);
}

async function broadcastStreamingEvent(
  app: Pick<App, "broadcast">,
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

    await app.broadcast.broadcastToTenantRateLimited(
      projectId,
      payload,
      "simulation_updated",
      tier,
    );
  } catch (err) {
    logger.warn({ err, projectId }, "Failed to broadcast streaming event");
  }
}
