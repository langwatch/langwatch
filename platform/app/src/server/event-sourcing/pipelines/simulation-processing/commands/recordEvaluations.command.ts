import { createHash } from "node:crypto";
import { createLogger } from "@langwatch/observability";
import { ValidationError } from "~/server/event-sourcing/services/errorHandling";
import type { GatedVerdict } from "~/server/scenarios/scenario-evaluation-gate";
import {
  gatedStatus,
  gatedVerdict,
} from "~/server/scenarios/scenario-evaluation-gate";
import type { ScenarioEvaluationResult } from "~/server/scenarios/schemas/event-schemas";
import type { Command, CommandHandler } from "../../../";
import { createTenantId, defineCommandSchema, EventUtils } from "../../../";
import { finishedStatusOf } from "../projections/simulationRunState.foldProjection";
import type { RecordEvaluationsCommandData } from "../schemas/commands";
import { recordEvaluationsCommandDataSchema } from "../schemas/commands";
import {
  SIMULATION_EVENT_VERSIONS,
  SIMULATION_RUN_COMMAND_TYPES,
  SIMULATION_RUN_EVENT_TYPES,
} from "../schemas/constants";
import type {
  SimulationProcessingEvent,
  SimulationRunEvaluatedEvent,
  SimulationRunEvaluatedEventData,
  SimulationRunFinishedEvent,
  SimulationRunQueuedEvent,
} from "../schemas/events";
import {
  isSimulationRunEvaluatedEvent,
  isSimulationRunFinishedEvent,
  isSimulationRunQueuedEvent,
} from "../schemas/events";

const logger = createLogger(
  "langwatch:simulation-processing:record-evaluations",
);

export interface RecordEvaluationsDeps {
  /**
   * Loads the run's prior events (log order). The finished event says the
   * run can take evaluations and what the judge decided; the queued event
   * names the run; an earlier evaluated event says what the run held before.
   */
  loadPriorEvents: (params: {
    tenantId: string;
    scenarioRunId: string;
  }) => Promise<readonly SimulationProcessingEvent[]>;
}

const SCHEMA = defineCommandSchema(
  SIMULATION_RUN_COMMAND_TYPES.RECORD_EVALUATIONS,
  recordEvaluationsCommandDataSchema,
  "Command to record the evaluator results of a finished simulation run",
);

/**
 * A short, stable digest of one set of results.
 *
 * The idempotency key carries it so a retry of the same results records one
 * event, while a different set of results (the evaluators ran again) records
 * a new event that replaces the first.
 */
export function evaluationsFingerprint(
  evaluations: ScenarioEvaluationResult[],
): string {
  return createHash("sha256")
    .update(JSON.stringify(evaluations))
    .digest("hex")
    .slice(0, 16);
}

/**
 * Finds the run's finished event among its prior events.
 *
 * A run that has not finished cannot take evaluations, so its absence is a
 * validation error the queue does not retry.
 */
function getFinishedEventOrThrow(
  priorEvents: readonly SimulationProcessingEvent[],
  scenarioRunId: string,
): SimulationRunFinishedEvent {
  const finished = priorEvents.find(isSimulationRunFinishedEvent);
  if (!finished) {
    throw new ValidationError(
      `Scenario run ${scenarioRunId} has not finished, evaluations can only be recorded on a finished run`,
      "scenarioRunId",
      scenarioRunId,
    );
  }
  return finished;
}

/** The verdict and status a run held right before this command's gate ran. */
interface PriorGateState {
  judgeVerdict: GatedVerdict | undefined;
  judgeStatus: string;
  previousVerdict: GatedVerdict | undefined;
  previousStatus: string;
}

/**
 * Reads the verdict and status the run held before this command's gate: the
 * judge's own verdict from the finished event, and either the last recorded
 * evaluation's verdict/status or the judge's, when this is the first one.
 */
function derivePriorGateState(params: {
  finished: SimulationRunFinishedEvent;
  lastEvaluated: SimulationRunEvaluatedEvent | undefined;
}): PriorGateState {
  const { finished, lastEvaluated } = params;

  const judgeVerdict = finished.data.results?.verdict;
  const judgeStatus = finishedStatusOf({
    explicitStatus: finished.data.status,
    verdict: judgeVerdict,
  });
  const previousVerdict = lastEvaluated
    ? lastEvaluated.data.verdict
    : judgeVerdict;
  const previousStatus = lastEvaluated
    ? (lastEvaluated.data.status ?? judgeStatus)
    : judgeStatus;

  return { judgeVerdict, judgeStatus, previousVerdict, previousStatus };
}

/**
 * Builds the RunEvaluated event data: the results, the verdict and status
 * the run holds after the gate, the ones it held before, and the run's
 * identity, falling back from the finished event to the queued event for
 * whichever identity fields the finished event does not carry.
 */
function buildEvaluatedEventData(params: {
  scenarioRunId: string;
  evaluations: ScenarioEvaluationResult[];
  status: string;
  previousStatus: string;
  verdict: GatedVerdict | undefined;
  previousVerdict: GatedVerdict | undefined;
  finished: SimulationRunFinishedEvent;
  queued: SimulationRunQueuedEvent | undefined;
}): SimulationRunEvaluatedEventData {
  const {
    scenarioRunId,
    evaluations,
    status,
    previousStatus,
    verdict,
    previousVerdict,
    finished,
    queued,
  } = params;

  const scenarioId = finished.data.scenarioId ?? queued?.data.scenarioId;
  const batchRunId = finished.data.batchRunId ?? queued?.data.batchRunId;
  const scenarioSetId =
    finished.data.scenarioSetId ?? queued?.data.scenarioSetId;

  return {
    scenarioRunId,
    evaluations,
    status,
    previousStatus,
    ...(verdict !== undefined && { verdict }),
    ...(previousVerdict !== undefined && { previousVerdict }),
    ...(scenarioId !== undefined && { scenarioId }),
    ...(batchRunId !== undefined && { batchRunId }),
    ...(scenarioSetId !== undefined && { scenarioSetId }),
  };
}

/**
 * Command handler that records evaluator results on a finished run.
 *
 * Emits the RunEvaluated event with everything a reader needs on the event
 * itself: the results, the verdict and status the run holds after the gate,
 * the verdict and status it held before, and the run's identity. All of it
 * is read from the run's prior events, never from the fold, so the fold and
 * the subscribers stay pure.
 *
 * A run that has not finished cannot take evaluations: the command is
 * refused with a validation error, which the queue does not retry.
 *
 * @see specs/scenarios/scenario-run-evaluations.feature
 */
export class RecordEvaluationsCommand
  implements
    CommandHandler<
      Command<RecordEvaluationsCommandData>,
      SimulationProcessingEvent
    >
{
  static readonly schema = SCHEMA;

  constructor(private readonly deps: RecordEvaluationsDeps) {}

  async handle(
    command: Command<RecordEvaluationsCommandData>,
  ): Promise<SimulationProcessingEvent[]> {
    const { tenantId: tenantIdStr, data } = command;
    const tenantId = createTenantId(tenantIdStr);
    const { scenarioRunId, evaluations } = data;

    const priorEvents = await this.deps.loadPriorEvents({
      tenantId: tenantIdStr,
      scenarioRunId,
    });

    const finished = getFinishedEventOrThrow(priorEvents, scenarioRunId);
    const queued = priorEvents.find(isSimulationRunQueuedEvent);
    const lastEvaluated = priorEvents
      .filter(isSimulationRunEvaluatedEvent)
      .at(-1);

    const { judgeVerdict, judgeStatus, previousVerdict, previousStatus } =
      derivePriorGateState({ finished, lastEvaluated });

    const verdict = gatedVerdict({ evaluations, judgeVerdict });
    const status = gatedStatus({ status: judgeStatus, verdict });

    const eventData = buildEvaluatedEventData({
      scenarioRunId,
      evaluations,
      status,
      previousStatus,
      verdict,
      previousVerdict,
      finished,
      queued,
    });

    const event = EventUtils.createEvent<SimulationRunEvaluatedEvent>({
      aggregateType: "simulation_run",
      aggregateId: scenarioRunId,
      tenantId,
      type: SIMULATION_RUN_EVENT_TYPES.EVALUATED,
      version: SIMULATION_EVENT_VERSIONS.EVALUATED,
      data: eventData,
      occurredAt: data.occurredAt,
      idempotencyKey: `${tenantIdStr}:${scenarioRunId}:recordEvaluations:${evaluationsFingerprint(evaluations)}`,
    });

    logger.debug(
      {
        tenantId: tenantIdStr,
        scenarioRunId,
        eventId: event.id,
        evaluationCount: evaluations.length,
        verdict,
        previousVerdict,
      },
      "Emitting simulation run evaluated event",
    );

    return [event];
  }

  static getAggregateId(payload: RecordEvaluationsCommandData): string {
    return payload.scenarioRunId;
  }

  static getSpanAttributes(
    payload: RecordEvaluationsCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.scenarioRun.id": payload.scenarioRunId,
      "payload.evaluations.count": payload.evaluations.length,
    };
  }

  static makeJobId(payload: RecordEvaluationsCommandData): string {
    return `${payload.tenantId}:${payload.scenarioRunId}:record-evaluations:${evaluationsFingerprint(payload.evaluations)}`;
  }
}
