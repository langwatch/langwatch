import type { Command } from "@langwatch/eventing";
import type {
  ExecuteEvaluationCommandData,
  EvaluationProcessingEvent,
} from "@langwatch/evaluation-contract";
import { createLogger } from "@langwatch/observability";
import {
  EvaluationExecutionIntentPort,
  type ExecuteEvaluationCommandDeps,
} from "../ports/evaluation.port";
import { EvaluationExecutionOutcomeService } from "./evaluation-execution-outcome.service";
import {
  EvaluationExecutionPreparationService,
  type EvaluationPreparationResult,
} from "./evaluation-execution-preparation.service";
import { EvaluationReportedEventService } from "./evaluation-reported-event.service";
export type { ExecuteEvaluationCommandDeps } from "../ports/evaluation.port";

const logger = createLogger("langwatch:evaluation-processing:execute-evaluation");

/** Coordinates preparation, external evaluation, and the reported event. */
export class EvaluationExecutionIntentService extends EvaluationExecutionIntentPort {
  static create(deps: ExecuteEvaluationCommandDeps): EvaluationExecutionIntentService {
    const reportedEvents = EvaluationReportedEventService.create(deps.inputsOffload);

    return new EvaluationExecutionIntentService(
      EvaluationExecutionPreparationService.create(deps),
      EvaluationExecutionOutcomeService.create({
        executionReceipt: deps.executionReceipt,
        reportedEvents,
      }),
      reportedEvents,
    );
  }

  private constructor(
    private readonly preparation: EvaluationExecutionPreparationService,
    private readonly outcome: EvaluationExecutionOutcomeService,
    private readonly reportedEvents: EvaluationReportedEventService,
  ) {
    super();
  }

  async execute(data: ExecuteEvaluationCommandData): Promise<EvaluationProcessingEvent[]> {
    logger.debug(
      {
        tenantId: data.tenantId,
        evaluationId: data.evaluationId,
        evaluatorId: data.evaluatorId,
        traceId: data.traceId,
      },
      "Handling execute evaluation command",
    );

    const prepared = await this.preparation.prepare(data);

    return this.handlePreparation(data, prepared);
  }

  handle(command: Command<ExecuteEvaluationCommandData>): Promise<EvaluationProcessingEvent[]> {
    return this.execute(command.data);
  }

  private handlePreparation(
    data: ExecuteEvaluationCommandData,
    prepared: EvaluationPreparationResult,
  ): Promise<EvaluationProcessingEvent[]> {
    if (prepared.kind === "drop") {
      return Promise.resolve([]);
    }

    if (prepared.kind === "reported-skip") {
      return this.reportSkip(data, prepared.details);
    }

    return this.outcome.execute(data, prepared.value);
  }

  private reportSkip(
    data: ExecuteEvaluationCommandData,
    details: string,
  ): Promise<EvaluationProcessingEvent[]> {
    return this.reportedEvents.emit(data, { status: "skipped", details });
  }
}

export { EvaluationExecutionIntentService as ExecuteEvaluationCommand };
