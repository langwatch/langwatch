import type {
  ExecuteEvaluationCommandData,
  EvaluationProcessingEvent,
} from "@langwatch/evaluation-contract";
import type { Command } from "@langwatch/eventing";
import type { MonitorApi } from "@langwatch/monitor-contract";
import { createLogger } from "@langwatch/observability";
import type { TraceApi } from "@langwatch/trace-contract";

import type { AzureSafetyCredentialsService } from "./azure-safety-credentials.service.ts";
import { EvaluationExecutionOutcomeService } from "./evaluation-execution-outcome.service.ts";
import {
  EvaluationExecutionPreparationService,
  type EvaluationPreparationResult,
} from "./evaluation-execution-preparation.service.ts";
import type { EvaluationExecutionReceiptService } from "./evaluation-execution-receipt.service.ts";
import type { EvaluationInputsOffload } from "./evaluation-inputs-offload.service.ts";
import { EvaluationReportedEventService } from "./evaluation-reported-event.service.ts";
import type { EvaluationSettingsRecoverySwitchService } from "./evaluation-settings-recovery-switch.service.ts";

const logger = createLogger("langwatch:evaluation-processing:execute-evaluation");

/** Coordinates preparation, external evaluation, and the reported event. */
export class EvaluationExecutionIntentService {
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
  ) {}

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

export interface ExecuteEvaluationCommandDeps {
  /** Throws `MonitorNotFoundError` when the monitor was deleted after the command was queued. */
  monitors: Pick<MonitorApi, "getById">;
  traces: Pick<TraceApi, "getEvaluationSpans" | "getEvaluationEvents">;
  executionReceipt: Pick<EvaluationExecutionReceiptService, "execute">;
  azureSafetyCredentials: Pick<AzureSafetyCredentialsService, "resolveForTenant">;
  settingsRecovery: Pick<EvaluationSettingsRecoverySwitchService, "isDisabled">;
  inputsOffload: EvaluationInputsOffload;
}
