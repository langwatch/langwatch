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
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { z } from "zod";
import { requires } from "@langwatch/api";
import {
  type AppRestBroadcast,
  type AppRestSecurity,
  baseResponses,
  type EndpointVariables,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
  type PlatformUrlBuilder,
  projectOf,
  type ProjectScopedContext,
  resolver,
} from "@langwatch/api/rest";

const logger = createLogger("langwatch:api:scenario-events");

/**
 * Externalises the inline media a reported event carries, rewriting the
 * event to reference the stored bytes by URL. The walk is the
 * stored-objects vertical's, arriving already bound to its store.
 */
export type InlineMediaExtraction = (input: {
  event: unknown;
  projectId: string;
  ownerKind: string;
  ownerId: string;
  purpose: string;
}) => Promise<{ rewrittenEvent: unknown; refs: readonly { id: string }[] }>;

/**
 * A run this project does not hold. The family answers it in the bare
 * `{ error }` body it has always had.
 */
class ScenarioRunNotThereError extends Error {}

const scenarioEventErrorHandler =
  (boundary: ErrorHandler): ErrorHandler =>
  (error, c) => {
    if (error instanceof ScenarioRunNotThereError) {
      return c.json({ error: error.message }, 404);
    }
    return boundary(error, c);
  };

const browserTabBodySchema = z.object({
  tabKey: z.string().min(1).max(200),
  batchRunId: z.string().min(1).max(200),
  scenarioSetId: z.string().min(1).max(200).optional(),
});

const archiveQuerySchema = z
  .object({
    scenarioSetId: z.string().min(1).optional(),
    scenarioRunId: z.string().min(1).optional(),
  })
  .refine(
    (query) => (query.scenarioSetId === undefined) !== (query.scenarioRunId === undefined),
    { message: "Pass exactly one of scenarioSetId or scenarioRunId as a query parameter" },
  );

/**
 * REST for the events an SDK reports while a scenario runs. Everything
 * needed from the process arrives as an argument: services, tenant
 * broadcast, media externalisation, and the two dependent middlewares.
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
}): MountableRestApp {
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

  const { service, policy } = security.createProjectVersionedApp({
    name: "scenario-events",
    basePath: "/api/scenario-events",
    errorEnvelope: "legacy",
    errorHandler: scenarioEventErrorHandler,
  });

  type ScenarioEventContext = ProjectScopedContext<EndpointVariables>;

  const reportHandler = async (
    c: ScenarioEventContext,
    validatedEvent: z.infer<typeof scenarioEventSchema>,
  ) => {
    const project = projectOf(c);

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
      return { success: true };
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

    return { success: true, url };
  };

  const browserTabHandler = async (
    c: ScenarioEventContext,
    input: z.infer<typeof browserTabBodySchema>,
  ) => {
    const project = projectOf(c);
    const { tabKey, batchRunId, scenarioSetId } = input;

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

    const hasLiveTab = await scenarioTabs().hasLiveTab({ projectId: project.id, tabKey });

    if (!hasLiveTab) {
      return { delivered: false, url };
    }

    const payload: ScenarioTabNavigatePayload = {
      event: SCENARIO_TAB_NAVIGATE_EVENT,
      tabKey,
      url,
    };

    // Parked before the broadcast so a tab reconnecting right now cannot slip
    // between the two and miss a run we already reported as delivered.
    await scenarioTabs().setPendingNavigate({ projectId: project.id, tabKey, url });

    await broadcast().broadcastToTenant(
      project.id,
      JSON.stringify(payload),
      "simulation_updated",
    );

    logger.info(
      { projectId: project.id, batchRunId },
      "Handed scenario batch to an open simulations tab",
    );

    return { delivered: true, url };
  };

  const archiveHandler = async (
    c: ScenarioEventContext,
    input: z.infer<typeof archiveQuerySchema>,
  ) => {
    const project = projectOf(c);
    const { scenarioSetId, scenarioRunId } = input;

    if (scenarioRunId !== undefined) {
      const archivedRun = await archiveScenarioRun({
        simulations: simulations(),
        projectId: project.id,
        scenarioRunId,
      });
      if (archivedRun === null) throw new ScenarioRunNotThereError("Scenario run not found");
      return archivedRun;
    }

    return await archiveScenarioSetRuns({
      simulations: simulations(),
      projectId: project.id,
      // The refine above guarantees exactly one scope, so setId is present.
      scenarioSetId: scenarioSetId!,
    });
  };

  return (
    service
      // Reporting an event creates run data, not a scenario definition, so it
      // asks for `scenarios:create`, not `:manage`. `:manage` still implies
      // `:create`, so every prior key/role still works; a viewer is declined as
      // before.
      .registerRoute("post", "/", MANAGEMENT_API_VERSION, reportHandler, (b) =>
        policy(requires("scenarios:create"))(b)
          .withInput(scenarioEventSchema)
          .withOutput(responseSchemas.success)
          .withStatus(201)
          // 50MB — accommodates inline media payloads
          .withMiddleware(traceUsageGuard, bodyLimit({ maxSize: 50 * 1024 * 1024 }))
          .withDocs({
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
      )
      // Offer a batch run to a tab already open on the caller's machine. If the
      // SDK's stamped tab key still has a live SSE subscription, the run
      // broadcasts there and the SDK skips opening a browser; otherwise it
      // falls back to opening one.
      .registerRoute("post", "/browser-tab", MANAGEMENT_API_VERSION, browserTabHandler, (b) =>
        policy(requires("scenarios:create"))(b)
          .withInput(browserTabBodySchema)
          .withOutput(responseSchemas.browserTabHandoff)
          .withDocs({
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
      )
      // Archive simulation runs. Exactly ONE scope is MANDATORY: a
      // scenarioSetId (archive every run in the set) or a scenarioRunId
      // (archive one run). An unqualified request is rejected so a single call
      // can never archive every run in the project. Stays at `:manage`: it is
      // destruction, and only the administration grain should carry it.
      .registerRoute("delete", "/", MANAGEMENT_API_VERSION, archiveHandler, (b) =>
        policy(requires("scenarios:manage"))(b)
          .withQuery(archiveQuerySchema)
          .withOutput(responseSchemas.archive)
          .withMiddleware(traceUsageGuard)
          .withDocs({
            description:
              "Archive simulation runs. Pass exactly one of `scenarioSetId` (archives every run in the set; `scenarioSetId=default` targets the implicit default set) or `scenarioRunId` (archives that one run).",
            responses: {
              ...baseResponses,
              200: {
                description: "Runs archived successfully",
                content: {
                  "application/json": { schema: resolver(responseSchemas.archive) },
                },
              },
              400: {
                description: "Missing or invalid scope parameter",
                content: {
                  "application/json": { schema: resolver(responseSchemas.error) },
                },
              },
              404: {
                description: "Scenario run not found in this project",
                content: {
                  "application/json": { schema: resolver(responseSchemas.error) },
                },
              },
            },
          }),
      )
      .build()
  );
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
 * Archives ONE simulation run after checking it belongs to the project.
 * Answers null when the project holds no such run, so a caller can never
 * archive another tenant's run by guessing its id. Exported as a test seam.
 */
export async function archiveScenarioRun({
  simulations,
  projectId,
  scenarioRunId,
}: {
  simulations: Pick<SimulationService, "tryGetScenarioRunData" | "deleteRun">;
  projectId: string;
  scenarioRunId: string;
}): Promise<{ archived: number; failed: number; scenarioRunId: string } | null> {
  const run = await simulations.tryGetScenarioRunData({ projectId, scenarioRunId });
  if (!run) return null;

  await simulations.deleteRun({
    tenantId: projectId,
    scenarioRunId,
    occurredAt: Date.now(),
  });

  return { archived: 1, failed: 0, scenarioRunId };
}

/**
 * Archives every active run in a set via one deleteRun command per run id
 * (test seam). Bounded-concurrency and failure-collecting: one rejection
 * never short-circuits the rest. `hasMore` reflects whether the lookup hit its cap.
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
