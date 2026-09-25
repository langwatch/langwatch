import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { createLogger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";
import {
  DEFAULT_SET_ID,
  encodeContent,
  encodeEnd,
  encodeStart,
  scenarioEventSchema,
  SCENARIO_TAB_NAVIGATE_EVENT,
  type ScenarioEvent,
  type ScenarioEventArchiveInput,
  type ScenarioEventArchiveResult,
  type ScenarioEventBrowserTabOfferInput,
  type ScenarioEventBrowserTabOfferResult,
  type ScenarioEventReportInput,
  ScenarioEventType,
  ScenarioEventArchiveScopeError,
  SimulationRunNotFoundError,
  type ScenarioTabNavigatePayload,
  type ScenarioTabRegistry,
  type SimulationService,
} from "@langwatch/scenario-contract";
import { nowInstant } from "@langwatch/time";
import type { TraceApi } from "@langwatch/trace-contract";

import type { ScenarioEventBroadcast } from "../channels/scenario-event-broadcast.channel.ts";

const logger = createLogger("langwatch:scenario-events");

export class ScenarioEventService {
  static create(input: {
    simulations: SimulationService;
    scenarioTabs: ScenarioTabRegistry;
    broadcast: ScenarioEventBroadcast;
    traces: TraceApi;
    entitlement: Pick<EntitlementApi, "assertWithinUsageLimit">;
    projects: Pick<ProjectApi, "getOrganizationId">;
  }): ScenarioEventService {
    return new ScenarioEventService(input);
  }

  #simulations: SimulationService;
  #scenarioTabs: ScenarioTabRegistry;
  #broadcast: ScenarioEventBroadcast;
  #traces: TraceApi;
  #entitlement: Pick<EntitlementApi, "assertWithinUsageLimit">;
  #projects: Pick<ProjectApi, "getOrganizationId">;

  private constructor(input: {
    simulations: SimulationService;
    scenarioTabs: ScenarioTabRegistry;
    broadcast: ScenarioEventBroadcast;
    traces: TraceApi;
    entitlement: Pick<EntitlementApi, "assertWithinUsageLimit">;
    projects: Pick<ProjectApi, "getOrganizationId">;
  }) {
    this.#simulations = input.simulations;
    this.#scenarioTabs = input.scenarioTabs;
    this.#broadcast = input.broadcast;
    this.#traces = input.traces;
    this.#entitlement = input.entitlement;
    this.#projects = input.projects;
  }

  async report(input: Pick<ScenarioEventReportInput, "projectId" | "event">): Promise<{
    scenarioSetId: string | null;
  }> {
    await this.#assertWithinUsageLimit(input.projectId);

    logger.info(
      {
        projectId: input.projectId,
        eventType: input.event.type,
        scenarioId: input.event.scenarioId,
        scenarioRunId: input.event.scenarioRunId,
        scenarioSetId: input.event.scenarioSetId,
      },
      "Received scenario event",
    );

    const extracted = await this.#traces.extractInlineMediaFromEvent({
      event: input.event,
      projectId: input.projectId,
      ownerKind: "scenario_run",
      ownerId: input.event.scenarioRunId,
      purpose: "scenario_event",
    });
    const event = scenarioEventSchema.parse(extracted.rewrittenEvent);

    if (extracted.refs.length > 0) {
      logger.info(
        {
          stored_object_ids: extracted.refs.map((ref) => ref.id),
          projectId: input.projectId,
          scenarioRunId: input.event.scenarioRunId,
          count: extracted.refs.length,
        },
        `scenario event extracted ${extracted.refs.length} stored object(s)`,
      );
    }

    await this.#dispatch(input.projectId, event);

    if (isStreamingEvent(event.type)) {
      await this.#broadcastStreaming(input.projectId, event);
      return { scenarioSetId: null };
    }

    if (
      event.type === ScenarioEventType.TEXT_MESSAGE_START ||
      event.type === ScenarioEventType.TEXT_MESSAGE_END
    ) {
      await this.#broadcastStreaming(input.projectId, event);
    }

    return { scenarioSetId: event.scenarioSetId || DEFAULT_SET_ID };
  }

  async offerBrowserTab(
    input: ScenarioEventBrowserTabOfferInput & { url: string },
  ): Promise<ScenarioEventBrowserTabOfferResult> {
    const hasLiveTab = await this.#scenarioTabs.hasLiveTab({
      projectId: input.projectId,
      tabKey: input.tabKey,
    });

    if (!hasLiveTab) return { delivered: false, url: input.url };

    const payload: ScenarioTabNavigatePayload = {
      event: SCENARIO_TAB_NAVIGATE_EVENT,
      tabKey: input.tabKey,
      url: input.url,
    };

    await this.#scenarioTabs.setPendingNavigate({
      projectId: input.projectId,
      tabKey: input.tabKey,
      url: input.url,
    });
    await this.#broadcast.broadcastToTenant(
      input.projectId,
      JSON.stringify(payload),
      "simulation_updated",
    );

    logger.info(
      { projectId: input.projectId, batchRunId: input.batchRunId },
      "Handed scenario batch to an open simulations tab",
    );

    return { delivered: true, url: input.url };
  }

  async archive(input: ScenarioEventArchiveInput): Promise<ScenarioEventArchiveResult> {
    await this.#assertWithinUsageLimit(input.projectId);

    const scenarioRunId = input.scenarioRunId;
    const scenarioSetId = input.scenarioSetId;
    if ((scenarioRunId === void 0) === (scenarioSetId === void 0)) {
      throw new ScenarioEventArchiveScopeError();
    }

    if (scenarioRunId !== void 0) {
      const run = await this.#simulations.findScenarioRunData({
        projectId: input.projectId,
        scenarioRunId,
      });
      if (run === null) throw new SimulationRunNotFoundError(scenarioRunId);

      await this.#simulations.deleteRun({
        tenantId: input.projectId,
        scenarioRunId,
        occurredAt: nowInstant().epochMilliseconds,
      });
      return { archived: 1, failed: 0, scenarioRunId };
    }

    if (scenarioSetId === void 0) throw new ScenarioEventArchiveScopeError();

    const { runIds, reachedCap } = await this.#simulations.getRunIdsForSet({
      projectId: input.projectId,
      scenarioSetId,
    });
    const occurredAt = nowInstant().epochMilliseconds;
    let archived = 0;
    let failed = 0;

    await pMapLimited({
      items: runIds,
      concurrency: 8,
      fn: async (scenarioRunId) => {
        try {
          await this.#simulations.deleteRun({
            tenantId: input.projectId,
            scenarioRunId,
            occurredAt,
          });
          archived += 1;
        } catch (error) {
          failed += 1;
          logger.warn(
            { projectId: input.projectId, scenarioRunId, error },
            "Failed to dispatch deleteRun",
          );
        }
      },
    });

    return {
      archived,
      failed,
      scenarioSetId,
      hasMore: reachedCap,
    };
  }

  /** Main's `blockTraceUsageExceededMiddleware`: refused with ERR_PLAN_LIMIT past the allowance. */
  async #assertWithinUsageLimit(projectId: string): Promise<void> {
    const organizationId = await this.#projects.getOrganizationId(projectId);
    await this.#entitlement.assertWithinUsageLimit({ organizationId });
  }

  async #dispatch(projectId: string, event: ScenarioEvent): Promise<void> {
    const base = {
      tenantId: projectId,
      scenarioRunId: event.scenarioRunId,
      occurredAt: event.timestamp ?? nowInstant().epochMilliseconds,
    };

    if (event.type === ScenarioEventType.RUN_STARTED) {
      await this.#simulations.startRun({
        ...base,
        scenarioId: event.scenarioId,
        batchRunId: event.batchRunId,
        scenarioSetId: event.scenarioSetId || DEFAULT_SET_ID,
        name: event.metadata?.name,
        description: event.metadata?.description,
        metadata: event.metadata,
      });
    } else if (event.type === ScenarioEventType.MESSAGE_SNAPSHOT) {
      const messages = event.messages ?? [];
      await this.#simulations.messageSnapshot({
        ...base,
        messages,
        traceIds: messages
          .map((message) => message.trace_id)
          .filter((traceId): traceId is string => typeof traceId === "string"),
      });
    } else if (event.type === ScenarioEventType.TEXT_MESSAGE_START) {
      await this.#simulations.textMessageStart({
        ...base,
        messageId: event.messageId,
        role: event.role,
        messageIndex: event.messageIndex,
      });
    } else if (event.type === ScenarioEventType.TEXT_MESSAGE_END) {
      await this.#simulations.textMessageEnd({
        ...base,
        messageId: event.messageId,
        role: event.role,
        content: event.content ?? "",
        message: event.message,
        traceId: event.traceId,
        messageIndex: event.messageIndex,
      });
    } else if (event.type === ScenarioEventType.RUN_FINISHED) {
      await this.#simulations.finishRun({
        ...base,
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

  async #broadcastStreaming(projectId: string, event: ScenarioEvent): Promise<void> {
    try {
      const payload = streamingPayload(event);
      const tier =
        event.type === ScenarioEventType.TEXT_MESSAGE_CONTENT ||
        event.type === ScenarioEventType.TOOL_CALL_ARGS
          ? "delta"
          : "structural";
      await this.#broadcast.broadcastToTenantRateLimited(
        projectId,
        payload,
        "simulation_updated",
        tier,
      );
    } catch (error) {
      logger.warn({ error, projectId }, "Failed to broadcast streaming event");
    }
  }
}

function isStreamingEvent(type: string): boolean {
  return (
    type === ScenarioEventType.TEXT_MESSAGE_CONTENT ||
    type === ScenarioEventType.TOOL_CALL_START ||
    type === ScenarioEventType.TOOL_CALL_ARGS ||
    type === ScenarioEventType.TOOL_CALL_END
  );
}

function streamingPayload(event: ScenarioEvent): string {
  if (event.type === ScenarioEventType.TEXT_MESSAGE_START) {
    return encodeStart({
      scenarioRunId: event.scenarioRunId,
      batchRunId: event.batchRunId,
      messageId: event.messageId,
      role: event.role,
      messageIndex: event.messageIndex,
    });
  }
  if (event.type === ScenarioEventType.TEXT_MESSAGE_CONTENT) {
    return encodeContent({
      scenarioRunId: event.scenarioRunId,
      batchRunId: event.batchRunId,
      messageId: event.messageId,
      delta: event.delta,
    });
  }
  if (event.type === ScenarioEventType.TEXT_MESSAGE_END) {
    return encodeEnd({
      scenarioRunId: event.scenarioRunId,
      batchRunId: event.batchRunId,
      messageId: event.messageId,
      content: event.content,
    });
  }
  return JSON.stringify({ e: event.type, r: event.scenarioRunId, b: event.batchRunId });
}

async function pMapLimited<T>(input: {
  items: T[];
  concurrency: number;
  fn: (item: T) => Promise<void>;
}): Promise<void> {
  const executing = new Set<Promise<void>>();
  for (const item of input.items) {
    const promise = input.fn(item).finally(() => executing.delete(promise));
    executing.add(promise);
    if (executing.size >= input.concurrency) await Promise.race(executing);
  }
  await Promise.all(executing);
}
