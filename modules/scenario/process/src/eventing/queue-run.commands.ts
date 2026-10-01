import type { Command, CommandHandler } from "@langwatch/eventing";
import {
  createTenantId,
  defineCommandSchema,
  EventUtils,
  stripEnvelope,
  withCommandEnvelope,
} from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import {
  SIMULATION_EVENT_VERSIONS,
  SIMULATION_RUN_COMMAND_TYPES,
  SIMULATION_RUN_EVENT_TYPES,
  simulationRunQueuedEventDataSchema,
} from "@langwatch/scenario-contract";
import type {
  RunEvaluators,
  SimulationProcessingEvent,
  SimulationRunQueuedEvent,
} from "@langwatch/scenario-contract";
import { extractSuiteId } from "@langwatch/suite-contract";
import type { z } from "zod";

const logger = createLogger("langwatch:simulation-processing:queue-run");

export const queueRunCommandDataSchema = withCommandEnvelope(simulationRunQueuedEventDataSchema);
export type QueueRunCommandData = z.infer<typeof queueRunCommandDataSchema>;

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
 * Handler for scheduling runs: resolves evaluators and records on event
 * (caller can supply to skip); lookup failure doesn't prevent grading.
 */
export class QueueRunCommand implements CommandHandler<
  Command<QueueRunCommandData>,
  SimulationProcessingEvent
> {
  static readonly schema = SCHEMA;

  constructor(private readonly deps?: QueueRunDeps) {}

  async handle(command: Command<QueueRunCommandData>): Promise<SimulationProcessingEvent[]> {
    const { tenantId: tenantIdStr, data } = command;
    const tenantId = createTenantId(tenantIdStr);

    const eventData = stripEnvelope(data);
    const evaluators =
      data.evaluators ?? (await this.resolveEvaluators({ tenantId: tenantIdStr, data }));

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
