import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import {
  ScenarioRunStatus,
  buildFailureResults,
  SIMULATION_EVENT_VERSIONS,
  SIMULATION_RUN_COMMAND_TYPES,
  SIMULATION_RUN_EVENT_TYPES,
  finishRunCommandDataSchema,
  isSimulationMessageSnapshotEvent,
  isSimulationRunQueuedEvent,
  isSimulationTextMessageEndEvent,
  type RunEvaluators,
  type FinishRunCommandData,
  type SimulationProcessingEvent,
  type SimulationRunFinishedEvent,
  type SimulationRunFinishedEventData,
} from "@langwatch/scenario-contract";
import { extractSuiteId } from "@langwatch/suite-contract";

const logger = createLogger("langwatch:simulation-processing:finish-run");

export interface FinishRunDeps {
  /**
   * Loads the run's prior events (log order) so the handler can backfill
   * ECST fields the caller did not supply: identity from the RunQueued
   * event, traceIds from MessageSnapshot/TextMessageEnd events.
   */
  loadPriorEvents: (params: {
    tenantId: string;
    scenarioRunId: string;
  }) => Promise<readonly SimulationProcessingEvent[]>;
  /**
   * The evaluators the scenario's suite and the run's plan attach right now.
   * Read only for a run whose own events carry none, which is a run driven
   * from code: it never passed through the queue command that pins them.
   */
  loadRunAttachments?: (params: {
    projectId: string;
    scenarioId: string;
    planId: string | null;
  }) => Promise<RunEvaluators>;
}

const SCHEMA = defineCommandSchema(
  SIMULATION_RUN_COMMAND_TYPES.FINISH,
  finishRunCommandDataSchema,
  "Command to mark a simulation run as finished",
);

/**
 * Collects traceIds from prior events, deduplicated in first-seen order:
 * MessageSnapshot `data.traceIds` arrays and TextMessageEnd `data.traceId`.
 */
function collectTraceIds(events: readonly SimulationProcessingEvent[]): string[] {
  const seen = new Set<string>();
  const traceIds: string[] = [];
  const push = (traceId: string | undefined) => {
    if (!traceId || seen.has(traceId)) return;
    seen.add(traceId);
    traceIds.push(traceId);
  };

  for (const event of events) {
    if (isSimulationMessageSnapshotEvent(event)) {
      for (const traceId of event.data.traceIds ?? []) {
        push(traceId);
      }
    } else if (isSimulationTextMessageEndEvent(event)) {
      push(event.data.traceId);
    }
  }

  return traceIds;
}

/**
 * Classifies results with failures but no reasoning: rewrites raw failures
 * so drawer renders named error instead of Node stack.
 */
function classifyUnjudgedResults({
  results,
  cancelled,
}: {
  results: NonNullable<FinishRunCommandData["results"]>;
  cancelled: boolean;
}): NonNullable<FinishRunCommandData["results"]> {
  const { error, reasoning, verdict } = results;
  if (verdict === "success") return results;
  if (error === undefined || error.trim().length === 0) return results;

  const reasonIsTheFailure =
    reasoning === undefined || reasoning.trim().length === 0 || reasoning.trim() === error.trim();
  if (!reasonIsTheFailure) return results;

  const classified = buildFailureResults({ cancelled, error });
  return {
    ...results,
    // A cancelled run never reached a judgement, so a caller-supplied
    // "failure" is not a verdict anyone decided. The other classifications
    // keep the caller's verdict, which already says the run did not pass.
    verdict: cancelled ? classified.verdict : results.verdict,
    reasoning: classified.reasoning,
    error: classified.error,
  };
}

/**
 * Results envelope for finished event: infrastructure callers (watchdog,
 * cancel-grace) supply bare error, classified on the way in.
 */
function buildFinishResults({
  data,
}: {
  data: FinishRunCommandData;
}): NonNullable<FinishRunCommandData["results"]> | undefined {
  const cancelled = data.status === ScenarioRunStatus.CANCELLED;
  if (data.results) {
    return classifyUnjudgedResults({ results: data.results, cancelled });
  }
  if (data.error !== undefined) {
    return buildFailureResults({ cancelled, error: data.error });
  }
  return undefined;
}

/**
 * Command handler for finishing runs: emits RunFinished with event-carried
 * state (identity, traceIds; optional deps for backward compat).
 */
export class FinishRunAdapter implements CommandHandler<
  Command<FinishRunCommandData>,
  SimulationProcessingEvent
> {
  static readonly schema = SCHEMA;

  static create(deps?: FinishRunDeps): FinishRunAdapter {
    return new FinishRunAdapter(deps);
  }

  constructor(private readonly deps?: FinishRunDeps) {}

  async handle(command: Command<FinishRunCommandData>): Promise<SimulationProcessingEvent[]> {
    const { tenantId: tenantIdStr, data } = command;
    const tenantId = createTenantId(tenantIdStr);
    const { scenarioRunId } = data;

    const ecst = await this.backfillEcstFields(tenantIdStr, data);
    const results = buildFinishResults({ data });

    const eventData: SimulationRunFinishedEventData = {
      scenarioRunId,
      ...(results !== undefined && { results }),
      ...(data.durationMs !== undefined && { durationMs: data.durationMs }),
      ...(data.status !== undefined && { status: data.status }),
      ...(ecst.scenarioId !== undefined && { scenarioId: ecst.scenarioId }),
      ...(ecst.batchRunId !== undefined && { batchRunId: ecst.batchRunId }),
      ...(ecst.scenarioSetId !== undefined && {
        scenarioSetId: ecst.scenarioSetId,
      }),
      ...(ecst.traceIds !== undefined && { traceIds: ecst.traceIds }),
      ...(ecst.target !== undefined && { target: ecst.target }),
      ...(ecst.evaluators !== undefined && { evaluators: ecst.evaluators }),
    };

    const event = EventUtils.createEvent<SimulationRunFinishedEvent>({
      aggregateType: "simulation_run",
      aggregateId: scenarioRunId,
      tenantId,
      type: SIMULATION_RUN_EVENT_TYPES.FINISHED,
      version: SIMULATION_EVENT_VERSIONS.FINISHED,
      data: eventData,
      occurredAt: data.occurredAt,
      idempotencyKey: `${tenantIdStr}:${scenarioRunId}:finishRun`,
    });

    logger.debug(
      { tenantId: tenantIdStr, scenarioRunId, eventId: event.id },
      "Emitting simulation run finished event",
    );

    return [event];
  }

  /**
   * Fills ECST gaps from prior events: caller-supplied fields win; backfills
   * identity, traceIds, target, evaluators (prior events always read for
   * evaluators).
   */
  private async backfillEcstFields(
    tenantId: string,
    data: FinishRunCommandData,
  ): Promise<
    Pick<
      SimulationRunFinishedEventData,
      "scenarioId" | "batchRunId" | "scenarioSetId" | "traceIds" | "target" | "evaluators"
    >
  > {
    const { scenarioRunId } = data;
    const result: Pick<
      SimulationRunFinishedEventData,
      "scenarioId" | "batchRunId" | "scenarioSetId" | "traceIds" | "target" | "evaluators"
    > = {
      scenarioId: data.scenarioId,
      batchRunId: data.batchRunId,
      scenarioSetId: data.scenarioSetId,
      traceIds: data.traceIds,
    };

    if (!this.deps?.loadPriorEvents) {
      logger.debug(
        { tenantId, scenarioRunId },
        "No loadPriorEvents dep; emitting RunFinished without ECST backfill",
      );
      return result;
    }

    const priorEvents = await this.deps.loadPriorEvents({
      tenantId,
      scenarioRunId,
    });

    const queuedEvent = priorEvents.find(isSimulationRunQueuedEvent);
    result.evaluators = queuedEvent?.data.evaluators;
    result.target = queuedEvent?.data.target;

    if (!result.scenarioId || !result.batchRunId || !result.scenarioSetId) {
      const queued = queuedEvent;
      if (queued) {
        // `||=`, not `??=`, so this fills exactly what the check above counts
        // as a gap. That check is falsy, so an empty-string id sends us here;
        // `??=` would then decline to overwrite it and the event would ship
        // with the empty id anyway, having paid for the lookup.
        result.scenarioId ||= queued.data.scenarioId;
        result.batchRunId ||= queued.data.batchRunId;
        result.scenarioSetId ||= queued.data.scenarioSetId;
      } else {
        logger.warn(
          { tenantId, scenarioRunId },
          "No RunQueued event found; RunFinished emitted without identity ECST fields",
        );
      }
    }

    result.traceIds ??= collectTraceIds(priorEvents);
    result.evaluators ??= await this.resolveEvaluators({
      tenantId,
      scenarioRunId,
      scenarioId: result.scenarioId,
      scenarioSetId: result.scenarioSetId,
    });

    return result;
  }

  /**
   * Resolves evaluators for code-driven runs (no queue event): read so runs
   * report evaluators pending and get graded (failed reads leave field off).
   */
  private async resolveEvaluators({
    tenantId,
    scenarioRunId,
    scenarioId,
    scenarioSetId,
  }: {
    tenantId: string;
    scenarioRunId: string;
    scenarioId: string | undefined;
    scenarioSetId: string | undefined;
  }): Promise<RunEvaluators | undefined> {
    if (!this.deps?.loadRunAttachments || !scenarioId) return undefined;
    try {
      return await this.deps.loadRunAttachments({
        projectId: tenantId,
        scenarioId,
        planId: scenarioSetId ? extractSuiteId(scenarioSetId) : null,
      });
    } catch (error) {
      logger.warn(
        { tenantId, scenarioRunId, error },
        "Could not read the run's evaluators when it finished",
      );
      return undefined;
    }
  }

  static getAggregateId(payload: FinishRunCommandData): string {
    return payload.scenarioRunId;
  }

  static getSpanAttributes(
    payload: FinishRunCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.scenarioRun.id": payload.scenarioRunId,
    };
  }

  static makeJobId(payload: FinishRunCommandData): string {
    return `${payload.tenantId}:${payload.scenarioRunId}:finish-run`;
  }
}

export { FinishRunAdapter as FinishRunCommand };
