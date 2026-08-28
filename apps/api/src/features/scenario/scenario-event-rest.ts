import { createLogger } from "@langwatch/observability";
import {
  DEFAULT_SET_ID,
  encodeContent,
  encodeEnd,
  encodeStart,
  responseSchemas,
  SCENARIO_TAB_NAVIGATE_EVENT,
  scenarioEventSchema,
  ScenarioEventType,
  type ScenarioEvent,
  type ScenarioTabNavigatePayload,
  type ScenarioTabRegistry,
  type SimulationService,
} from "@langwatch/scenario-contract";
import { describeRoute, resolver } from "hono-openapi";
import type { MiddlewareHandler } from "hono";
import { z } from "zod";
import {
  type AppRestBroadcast,
  type AppRestProjectVariables,
  type AppRestSecurity,
  baseResponses,
  type PlatformUrlBuilder,
  requires,
  type SecuredApp,
  validator as zValidator,
} from "../../app-rest";

const logger = createLogger("langwatch:api:scenario-events");

/**
 * Externalises the inline media a reported event carries, rewriting the event
 * to reference the stored bytes by URL.
 *
 * The walk itself is the stored-objects vertical's, and it needs that
 * vertical's content-addressed store, so it arrives already bound to one. Only
 * the ids of what it stored are read back here, for the log line.
 */
export type InlineMediaExtraction = (input: {
  event: unknown;
  projectId: string;
  ownerKind: string;
  ownerId: string;
  purpose: string;
}) => Promise<{ rewrittenEvent: unknown; refs: readonly { id: string }[] }>;

/**
 * REST for the events an SDK reports while a scenario runs.
 *
 * Everything the family needs from the process arrives as an argument: the
 * simulation and tab services it dispatches to, the tenant broadcast the live
 * simulations page reads, the media externalisation the stored-objects
 * vertical owns, and the two middlewares whose implementations depend on this
 * process's plan store and Node bridge.
 */
export function createScenarioEventsRestApp(options: {
  security: AppRestSecurity;
  simulations: () => SimulationService;
  scenarioTabs: () => ScenarioTabRegistry;
  broadcast: () => AppRestBroadcast;
  extractInlineMedia: InlineMediaExtraction;
  /** Refuses ingest once the project's team has spent its plan's allowance. */
  traceUsageGuard: MiddlewareHandler;
  /** Caps a request body at `maxSize` bytes, refusing anything larger with 413. */
  bodyLimit: (options: { maxSize: number }) => MiddlewareHandler;
  /** Absolute links back into this instance. Injected rather than read from the
   *  environment here: a feature receives typed configuration, and the
   *  composition root is the one place that parses it. */
  platformUrl: PlatformUrlBuilder;
}): SecuredApp<{ Variables: AppRestProjectVariables }> {
  const {
    security,
    simulations,
    scenarioTabs,
    broadcast,
    extractInlineMedia,
    traceUsageGuard,
    bodyLimit,
    platformUrl,
  } = options;

  const secured = security.createProjectApp({ basePath: "/api/scenario-events" });

  // POST /api/scenario-events - Create a new scenario event
  //
  // Reporting a scenario event creates run data; it never touches a scenario
  // definition, so it asks for `scenarios:create` rather than the administration
  // grain. `:manage` still implies `:create` through the RBAC hierarchy, so every
  // SDK key and role that could report events yesterday still can; a viewer holds
  // only `scenarios:view` and is declined exactly as before.
  secured.access(requires("scenarios:create")).post(
    "/",
    traceUsageGuard,
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
      const { rewrittenEvent: rawRewritten, refs } = await extractInlineMedia({
        event: validatedEvent,
        projectId: project.id,
        ownerKind: "scenario_run",
        ownerId: validatedEvent.scenarioRunId,
        purpose: "scenario_event",
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

      await dispatchSimulationEvent(simulations(), project.id, event);

      // Streaming events: broadcast only, no persistence
      if (isStreamingEvent(event.type)) {
        await broadcastStreamingEvent(broadcast(), project.id, event);
        return c.json({ success: true }, 201);
      }

      // Broadcast START/END directly so the frontend gets them immediately
      // (the subscriber's debounced broadcast is too slow and causes CONTENT
      // deltas to be dropped). Works regardless of event-sourcing flag.
      if (
        event.type === ScenarioEventType.TEXT_MESSAGE_START ||
        event.type === ScenarioEventType.TEXT_MESSAGE_END
      ) {
        await broadcastStreamingEvent(broadcast(), project.id, event);
      }

      const url = platformUrl({
        projectSlug: project.slug,
        path: `/simulations/${event.scenarioSetId || DEFAULT_SET_ID}`,
      });

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

      // Built server-side from ids rather than accepted as a URL: a handoff can
      // only ever point a browser at this instance's own simulations page. The
      // ids are caller-supplied and only length-bounded, so they are encoded — a
      // `#` or `?` in one would otherwise truncate the rest of the path.
      const url = platformUrl({
        projectSlug: project.slug,
        path: `/simulations/${encodeURIComponent(
          scenarioSetId || DEFAULT_SET_ID,
        )}/${encodeURIComponent(batchRunId)}`,
      });

      const hasLiveTab = await scenarioTabs().hasLiveTab({
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
      await scenarioTabs().setPendingNavigate({
        projectId: project.id,
        tabKey,
        url,
      });

      await broadcast().broadcastToTenant(
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
  secured.access(requires("scenarios:manage")).delete(
    "/",
    traceUsageGuard,
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
        simulations: simulations(),
        projectId: project.id,
        scenarioSetId,
      });

      return c.json(result, 200);
    },
  );

  return secured;
}

async function dispatchSimulationEvent(
  simulations: SimulationService,
  projectId: string,
  event: ScenarioEvent,
): Promise<void> {
  const basePayload = {
    tenantId: projectId,
    scenarioRunId: event.scenarioRunId,
    occurredAt: event.timestamp ?? Date.now(),
  };

  if (event.type === ScenarioEventType.RUN_STARTED) {
    await simulations.startRun({
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
    await simulations.messageSnapshot({
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
    await simulations.textMessageStart({
      ...basePayload,
      messageId: event.messageId,
      role: event.role,
      messageIndex: event.messageIndex,
    });
  } else if (event.type === ScenarioEventType.TEXT_MESSAGE_END) {
    await simulations.textMessageEnd({
      ...basePayload,
      messageId: event.messageId,
      role: event.role,
      content: event.content ?? "",
      message: event.message,
      traceId: event.traceId,
      messageIndex: event.messageIndex,
    });
  } else if (event.type === ScenarioEventType.RUN_FINISHED) {
    await simulations.finishRun({
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
  simulations,
  projectId,
  scenarioSetId,
}: {
  simulations: Pick<SimulationService, "getRunIdsForSet" | "deleteRun">;
  projectId: string;
  scenarioSetId: string;
}): Promise<{
  archived: number;
  failed: number;
  scenarioSetId: string;
  hasMore: boolean;
}> {
  const { runIds, reachedCap } = await simulations.getRunIdsForSet({
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
        await simulations.deleteRun({
          tenantId: projectId,
          scenarioRunId: id,
          occurredAt: now,
        });
        archived++;
      } catch (err) {
        failed++;
        logger.warn({ projectId, scenarioRunId: id, err }, "Failed to dispatch deleteRun");
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
  broadcast: AppRestBroadcast,
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

    await broadcast.broadcastToTenantRateLimited(projectId, payload, "simulation_updated", tier);
  } catch (err) {
    logger.warn({ err, projectId }, "Failed to broadcast streaming event");
  }
}
