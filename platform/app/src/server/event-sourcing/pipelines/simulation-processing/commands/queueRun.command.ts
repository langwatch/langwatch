import { createLogger } from "@langwatch/observability";
import type { RunEvaluators } from "~/server/scenarios/scenario-run-evaluators";
import { extractSuiteId } from "~/server/suites/suite-set-id";
import type { Command, CommandHandler } from "../../../";
import { createTenantId, defineCommandSchema, EventUtils } from "../../../";
import {
  stripEnvelope,
  withCommandEnvelope,
} from "../../../commands/commandEnvelope";
import {
  SIMULATION_EVENT_VERSIONS,
  SIMULATION_RUN_COMMAND_TYPES,
  SIMULATION_RUN_EVENT_TYPES,
} from "../schemas/constants";
import type {
  SimulationProcessingEvent,
  SimulationRunQueuedEvent,
} from "../schemas/events";
import { simulationRunQueuedEventDataSchema } from "../schemas/events";

const logger = createLogger("langwatch:simulation-processing:queue-run");

export const queueRunCommandDataSchema = withCommandEnvelope(
  simulationRunQueuedEventDataSchema,
);
export type QueueRunCommandData = typeof queueRunCommandDataSchema._type;

export interface QueueRunDeps {
  /** The evaluators the scenario's suite and the run's plan attach right now. */
  loadRunAttachments(params: {
    projectId: string;
    scenarioId: string;
    planId: string | null;
  }): Promise<RunEvaluators>;
}

const SCHEMA = defineCommandSchema(
  SIMULATION_RUN_COMMAND_TYPES.QUEUE,
  queueRunCommandDataSchema,
  "Command to schedule a simulation run",
);

/**
 * Command handler for scheduling a simulation run.
 *
 * Resolves the evaluators the run will be graded with and records them on the
 * queued event, so the set is fixed the moment the run is scheduled. Editing
 * the suite or the run plan while the batch executes changes the runs queued
 * after the edit and never the ones already scheduled, and the evaluation job
 * grades the same set on every retry.
 *
 * A caller that already resolved them supplies `evaluators` and the lookup is
 * skipped, which is how a batch resolves once for every run it schedules. A
 * lookup that fails leaves the field off the event: FinishRunCommand resolves
 * it again when the run finishes, so a run is never left ungraded because a
 * read failed at schedule time.
 *
 * @see specs/scenarios/scenario-evaluation-pending.feature
 */
export class QueueRunCommand
  implements
    CommandHandler<Command<QueueRunCommandData>, SimulationProcessingEvent>
{
  static readonly schema = SCHEMA;

  constructor(private readonly deps?: QueueRunDeps) {}

  async handle(
    command: Command<QueueRunCommandData>,
  ): Promise<SimulationProcessingEvent[]> {
    const { tenantId: tenantIdStr, data } = command;
    const tenantId = createTenantId(tenantIdStr);

    const eventData = stripEnvelope(data);
    const evaluators =
      data.evaluators ??
      (await this.resolveEvaluators({ tenantId: tenantIdStr, data }));

    const event = EventUtils.createEvent<SimulationRunQueuedEvent>({
      aggregateType: "simulation_run",
      aggregateId: data.scenarioRunId,
      tenantId,
      type: SIMULATION_RUN_EVENT_TYPES.QUEUED,
      version: SIMULATION_EVENT_VERSIONS.QUEUED,
      data: { ...eventData, ...(evaluators && { evaluators }) },
      occurredAt: data.occurredAt,
      idempotencyKey: `${tenantIdStr}:${data.scenarioRunId}:queueRun`,
    });

    return [event];
  }

  /** The attachments the run is graded with, or none when they cannot be read. */
  private async resolveEvaluators({
    tenantId,
    data,
  }: {
    tenantId: string;
    data: QueueRunCommandData;
  }): Promise<RunEvaluators | undefined> {
    if (!this.deps?.loadRunAttachments) return undefined;
    try {
      return await this.deps.loadRunAttachments({
        projectId: tenantId,
        scenarioId: data.scenarioId,
        planId: data.scenarioSetId ? extractSuiteId(data.scenarioSetId) : null,
      });
    } catch (error) {
      logger.warn(
        { tenantId, scenarioRunId: data.scenarioRunId, error },
        "Could not read the run's evaluators when it was queued; they are read again when it finishes",
      );
      return undefined;
    }
  }

  static getAggregateId(payload: QueueRunCommandData): string {
    return payload.scenarioRunId;
  }

  static getSpanAttributes(
    payload: QueueRunCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.scenarioRun.id": payload.scenarioRunId,
      "payload.scenario.id": payload.scenarioId,
      "payload.batchRun.id": payload.batchRunId,
    };
  }

  static makeJobId(payload: QueueRunCommandData): string {
    return `${payload.tenantId}:${payload.scenarioRunId}:queue-run`;
  }
}
