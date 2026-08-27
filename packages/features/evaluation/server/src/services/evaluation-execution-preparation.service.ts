import {
  AZURE_SAFETY_NOT_CONFIGURED_MESSAGE,
  isAzureEvaluatorType,
  type ExecuteEvaluationCommandData,
} from "@langwatch/evaluation-contract";
import type { MonitorService, MonitorWithEvaluator } from "@langwatch/monitor-contract";
import type { EvaluationTraceEvent, TraceService } from "@langwatch/trace-contract";
import { createLogger } from "@langwatch/observability";
import {
  EvaluationAzureSafetyCredentialsPort,
  EvaluationSettingsRecoveryPort,
} from "../ports/evaluation.port";
import { EvaluationPreconditionService } from "./evaluation-precondition.service";
import {
  EvaluatorSettingsService,
  type EvaluatorSettingsSource,
} from "./evaluator-settings.service";

const logger = createLogger("langwatch:evaluation-processing:execute-evaluation");

type Monitor = MonitorWithEvaluator;

export type PreparedEvaluation = {
  monitor: Monitor;
  settings: Record<string, unknown> | null | undefined;
  source: EvaluatorSettingsSource;
};

export type EvaluationPreparationResult =
  | { kind: "ready"; value: PreparedEvaluation }
  | { kind: "reported-skip"; details: string }
  | { kind: "drop" };

export class EvaluationExecutionPreparationService {
  static create(input: {
    monitors: MonitorService;
    traces: TraceService;
    azureSafetyCredentials: EvaluationAzureSafetyCredentialsPort;
    settingsRecovery: EvaluationSettingsRecoveryPort;
  }): EvaluationExecutionPreparationService {
    return new EvaluationExecutionPreparationService(
      input,
      EvaluationPreconditionService.create(),
      EvaluatorSettingsService.create(),
    );
  }

  private constructor(
    private readonly deps: {
      monitors: MonitorService;
      traces: TraceService;
      azureSafetyCredentials: EvaluationAzureSafetyCredentialsPort;
      settingsRecovery: EvaluationSettingsRecoveryPort;
    },
    private readonly preconditions: EvaluationPreconditionService,
    private readonly settings: EvaluatorSettingsService,
  ) {}

  async prepare(data: ExecuteEvaluationCommandData): Promise<EvaluationPreparationResult> {
    const monitor = await this.deps.monitors.tryGetMonitorById({
      projectId: data.tenantId,
      id: data.evaluatorId,
    });
    if (!monitor) {
      logger.warn(
        { tenantId: data.tenantId, evaluatorId: data.evaluatorId },
        "Monitor not found — skipping evaluation",
      );

      return { kind: "reported-skip", details: "Monitor not found" };
    }

    const azureSkip = await this.azureSkip(data, monitor);
    if (azureSkip) {
      return azureSkip;
    }

    if (!this.isSampled(data, monitor.sample)) {
      return { kind: "drop" };
    }

    const spans = await this.deps.traces.getEvaluationSpans({
      tenantId: data.tenantId,
      traceId: data.traceId,
      occurredAtMs: data.occurredAt,
    });
    if (!this.preconditions.requiredFieldsArePresent({ evaluatorType: monitor.checkType, spans })) {
      logger.debug(
        {
          tenantId: data.tenantId,
          evaluatorId: data.evaluatorId,
          traceId: data.traceId,
        },
        "Evaluator required fields not met — skipping evaluation",
      );

      return { kind: "drop" };
    }

    const events = await this.loadEvents(data, monitor.preconditions);
    if (
      !this.preconditions.areMet({
        data,
        preconditions: monitor.preconditions,
        spans,
        events,
      })
    ) {
      logger.debug(
        {
          tenantId: data.tenantId,
          evaluatorId: data.evaluatorId,
          traceId: data.traceId,
        },
        "Preconditions not met — skipping evaluation",
      );

      return { kind: "drop" };
    }

    const resolved = this.settings.resolve({
      config: monitor.evaluator?.config as Record<string, unknown> | null,
      parameters: monitor.parameters as Record<string, unknown> | null,
      evaluatorRecordType: monitor.evaluator?.type,
      recoveryDisabled: await this.readSettingsRecoveryFlag(),
    });
    this.logRecovery(data, resolved.source, resolved.settings);

    return { kind: "ready", value: { monitor, ...resolved } };
  }

  private async azureSkip(
    data: ExecuteEvaluationCommandData,
    monitor: Monitor,
  ): Promise<{ kind: "reported-skip"; details: string } | null> {
    if (!isAzureEvaluatorType(monitor.checkType)) {
      return null;
    }

    const credentials = await this.deps.azureSafetyCredentials.tryGetForTenant({
      tenantId: data.tenantId,
    });

    return credentials ? null : this.reportAzureSkip(data, monitor);
  }

  private reportAzureSkip(
    data: ExecuteEvaluationCommandData,
    monitor: Monitor,
  ): { kind: "reported-skip"; details: string } {
    logger.warn(
      {
        tenantId: data.tenantId,
        evaluatorId: data.evaluatorId,
        evaluatorType: monitor.checkType,
      },
      "Azure Safety provider not configured — skipping evaluation",
    );

    return { kind: "reported-skip", details: AZURE_SAFETY_NOT_CONFIGURED_MESSAGE };
  }

  private isSampled(data: ExecuteEvaluationCommandData, sample: number): boolean {
    const sampled = Math.random() <= sample;
    if (!sampled) {
      logger.debug(
        { tenantId: data.tenantId, evaluatorId: data.evaluatorId, sample },
        "Evaluation excluded by sampling",
      );
    }

    return sampled;
  }

  private async loadEvents(
    data: ExecuteEvaluationCommandData,
    preconditions: unknown,
  ): Promise<EvaluationTraceEvent[] | null> {
    if (!this.preconditions.needEvents(preconditions)) {
      return null;
    }

    return this.deps.traces.getEvaluationEvents({
      tenantId: data.tenantId,
      traceId: data.traceId,
    });
  }

  private async readSettingsRecoveryFlag(): Promise<boolean> {
    try {
      return await this.deps.settingsRecovery.isDisabled();
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "Settings-recovery rollback flag could not be read — leaving recovery active",
      );

      return false;
    }
  }

  private logRecovery(
    data: ExecuteEvaluationCommandData,
    source: EvaluatorSettingsSource,
    settings: Record<string, unknown> | null | undefined,
  ): void {
    if (source !== "top-level-recovery") {
      return;
    }

    logger.info(
      {
        tenantId: data.tenantId,
        evaluatorId: data.evaluatorId,
        traceId: data.traceId,
        recoveredKeyCount: Object.keys(settings ?? {}).length,
        recoveredPrompt: Object.hasOwn(settings ?? {}, "prompt"),
      },
      "Recovered evaluator settings from the top level of config — langwatch#6397 affected config",
    );
  }
}
