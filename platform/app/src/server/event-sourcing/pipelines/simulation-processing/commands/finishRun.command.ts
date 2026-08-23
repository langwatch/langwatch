import type { Command, CommandHandler } from "@langwatch/eventing";
import {
  createTenantId,
  defineCommandSchema,
  EventUtils,
} from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { buildFailureResults } from "~/server/scenarios/scenario-failure-results";
import type { FinishRunCommandData } from "../schemas/commands";
import { finishRunCommandDataSchema } from "../schemas/commands";
import {
  SIMULATION_EVENT_VERSIONS,
  SIMULATION_RUN_COMMAND_TYPES,
  SIMULATION_RUN_EVENT_TYPES,
} from "../schemas/constants";
import type {
  SimulationProcessingEvent,
  SimulationRunFinishedEvent,
  SimulationRunFinishedEventData,
} from "../schemas/events";
import {
  isSimulationMessageSnapshotEvent,
  isSimulationRunQueuedEvent,
  isSimulationTextMessageEndEvent,
} from "../schemas/events";

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
function collectTraceIds(
  events: readonly SimulationProcessingEvent[],
): string[] {
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
 * Command handler for finishing a simulation run.
 *
 * Emits the RunFinished event with event-carried state (ECST): identity
 * (scenarioId/batchRunId/scenarioSetId) and traceIds ride on the event so
 * downstream subscribers never read fold state. Callers may supply them on
 * the command; any gap is backfilled from the run's prior events via the
 * injected `loadPriorEvents`.
 *
 * Uses constructor DI like ComputeRunMetricsCommand. The deps are optional
 * ONLY so the pipeline's current `.withCommand("finishRun", FinishRunCommand)`
 * registration (zero-arg constructor) keeps compiling until the wiring
 * switches to `.withCommandInstance(...)`; without deps the handler emits
 * exactly what the caller supplied, with no backfill.
 */
export class FinishRunCommand
  implements
    CommandHandler<Command<FinishRunCommandData>, SimulationProcessingEvent>
{
  static readonly schema = SCHEMA;

  constructor(private readonly deps?: FinishRunDeps) {}

  async handle(
    command: Command<FinishRunCommandData>,
  ): Promise<SimulationProcessingEvent[]> {
    const { tenantId: tenantIdStr, data } = command;
    const tenantId = createTenantId(tenantIdStr);
    const { scenarioRunId } = data;

    const ecst = await this.backfillEcstFields(tenantIdStr, data);

    // Infrastructure callers (stall watchdog, cancel-grace) supply a bare
    // `error` and no verdict; synthesize the same failure-results envelope
    // the in-process failure path writes, so the reason is recorded on the
    // event rather than lost. A caller-supplied `results` always wins.
    const results =
      data.results ??
      (data.error !== undefined
        ? buildFailureResults({
            cancelled: data.status === ScenarioRunStatus.CANCELLED,
            error: data.error,
          })
        : undefined);

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
   * Fills ECST gaps from the run's prior events. Caller-supplied fields
   * always win; only missing ones are backfilled (identity from RunQueued,
   * traceIds from MessageSnapshot/TextMessageEnd).
   */
  private async backfillEcstFields(
    tenantId: string,
    data: FinishRunCommandData,
  ): Promise<
    Pick<
      SimulationRunFinishedEventData,
      "scenarioId" | "batchRunId" | "scenarioSetId" | "traceIds"
    >
  > {
    const { scenarioRunId } = data;
    const result = {
      scenarioId: data.scenarioId,
      batchRunId: data.batchRunId,
      scenarioSetId: data.scenarioSetId,
      traceIds: data.traceIds,
    };

    const hasGaps =
      !result.scenarioId ||
      !result.batchRunId ||
      !result.scenarioSetId ||
      result.traceIds === undefined;
    if (!hasGaps) return result;

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

    if (!result.scenarioId || !result.batchRunId || !result.scenarioSetId) {
      const queued = priorEvents.find(isSimulationRunQueuedEvent);
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

    return result;
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
