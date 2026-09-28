/**
 * ExecuteExperimentCell: the worker runs one cell and appends what it produced, then its
 * `cell_finished`, in one batch (ARCHITECTURE §9). Each event keeps the identity its own command
 * would give it, so a cell run twice appends nothing twice. Design: experiment-run-execution.md §3.
 */
import {
  type Command,
  type CommandHandler,
  createTenantId,
  defineCommandSchema,
  EventUtils,
  stripEnvelope,
  withCommandEnvelope,
} from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";
import { z } from "zod";

import {
  EXPERIMENT_RUN_COMMAND_TYPES,
  EXPERIMENT_RUN_EVENT_TYPES,
  EXPERIMENT_RUN_EVENT_VERSIONS,
} from "../rules/experiment-run-event-types.rules.ts";
import { makeExperimentRunKey } from "../rules/experiment-run-key.rules.ts";
import type {
  ExperimentCellExecution,
  ExperimentCellRequest,
  ExperimentCellResult,
} from "../services/experiment-run-cell.service.ts";
import type {
  CellFinishedEvent,
  EvaluatorResultEvent,
  ExperimentRunProcessingEvent,
  TargetResultEvent,
} from "./experiment-run-events.process.ts";
import {
  cellFinishedIdentity,
  evaluatorResultIdentity,
  targetResultIdentity,
} from "./experiment-run-processing.commands.ts";

export const executeExperimentCellCommandDataSchema = withCommandEnvelope(
  z.object({
    runId: z.string(),
    experimentId: z.string(),
    ordinal: z.number().int().nonnegative(),
    phase: z.union([z.literal(1), z.literal(2)]),
  }),
);

export type ExecuteExperimentCellCommandData = z.infer<
  typeof executeExperimentCellCommandDataSchema
>;

const SCHEMA = defineCommandSchema(
  EXPERIMENT_RUN_COMMAND_TYPES.EXECUTE_CELL,
  executeExperimentCellCommandDataSchema,
  "Runs one cell of an experiment run",
);

/** The service a cell command runs; the command only turns its answer into events. */
type RunCells = { execute(request: ExperimentCellRequest): Promise<ExperimentCellExecution> };

export class ExecuteExperimentCellCommand implements CommandHandler<
  Command<ExecuteExperimentCellCommandData>,
  ExperimentRunProcessingEvent
> {
  static readonly schema = SCHEMA;

  static create({ cells }: { cells: RunCells }): ExecuteExperimentCellCommand {
    return new ExecuteExperimentCellCommand(cells);
  }

  private constructor(private readonly cells: RunCells) {}

  async handle(
    command: Command<ExecuteExperimentCellCommandData>,
  ): Promise<ExperimentRunProcessingEvent[]> {
    const { data } = command;
    const executed = await this.cells.execute({
      projectId: command.tenantId,
      runId: data.runId,
      experimentId: data.experimentId,
      ordinal: data.ordinal,
      phase: data.phase,
    });
    const aggregateId = makeExperimentRunKey(data.experimentId, data.runId);
    const tenantId = createTenantId(command.tenantId);

    const finished = EventUtils.createEvent<CellFinishedEvent>({
      aggregateType: "experiment_run",
      aggregateId,
      tenantId,
      type: EXPERIMENT_RUN_EVENT_TYPES.CELL_FINISHED,
      version: EXPERIMENT_RUN_EVENT_VERSIONS.CELL_FINISHED,
      data: {
        runId: data.runId,
        experimentId: data.experimentId,
        ordinal: data.ordinal,
        phase: data.phase,
        outcome: executed.outcome,
        ...(executed.error ? { error: executed.error } : {}),
      },
      occurredAt: nowInstant().epochMilliseconds,
      idempotencyKey: cellFinishedIdentity({ ...data, tenantId: command.tenantId }),
    });

    return [
      ...executed.results.map((result) => resultEvent({ result, aggregateId, tenantId })),
      finished,
    ];
  }

  static getAggregateId(payload: ExecuteExperimentCellCommandData): string {
    return makeExperimentRunKey(payload.experimentId, payload.runId);
  }

  /** Each cell its own queue group, so one run's cells run side by side (spec section 5). */
  static getGroupKey(payload: ExecuteExperimentCellCommandData): string {
    return `${makeExperimentRunKey(payload.experimentId, payload.runId)}:cell:${payload.ordinal}:${payload.phase}`;
  }

  static getSpanAttributes(
    payload: ExecuteExperimentCellCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.run.id": payload.runId,
      "payload.experiment.id": payload.experimentId,
      "payload.cell.ordinal": payload.ordinal,
      "payload.cell.phase": payload.phase,
    };
  }
}

/** The job id a redelivered cell intent collapses onto while the first is still queued. */
export function executeExperimentCellJobId(payload: ExecuteExperimentCellCommandData): string {
  return `${payload.tenantId}:${payload.runId}:${payload.ordinal}:${payload.phase}`;
}

function resultEvent({
  result,
  aggregateId,
  tenantId,
}: {
  result: ExperimentCellResult;
  aggregateId: string;
  tenantId: ReturnType<typeof createTenantId>;
}): TargetResultEvent | EvaluatorResultEvent {
  if (result.kind === "target") {
    return EventUtils.createEvent<TargetResultEvent>({
      aggregateType: "experiment_run",
      aggregateId,
      tenantId,
      type: EXPERIMENT_RUN_EVENT_TYPES.TARGET_RESULT,
      version: EXPERIMENT_RUN_EVENT_VERSIONS.TARGET_RESULT,
      data: stripEnvelope(result.data),
      occurredAt: result.data.occurredAt,
      idempotencyKey: targetResultIdentity(result.data),
    });
  }

  return EventUtils.createEvent<EvaluatorResultEvent>({
    aggregateType: "experiment_run",
    aggregateId,
    tenantId,
    type: EXPERIMENT_RUN_EVENT_TYPES.EVALUATOR_RESULT,
    version: EXPERIMENT_RUN_EVENT_VERSIONS.EVALUATOR_RESULT,
    data: stripEnvelope(result.data),
    occurredAt: result.data.occurredAt,
    idempotencyKey: evaluatorResultIdentity(result.data),
  });
}
