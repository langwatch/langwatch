import type { EvaluationService } from "@langwatch/evaluation-contract";
import {
  EvaluationAdapter,
  EvaluationExecutionPort,
  EvaluationInputsResolutionPort,
  type EvaluationClickHouseResolver,
  type EvaluationRetentionFloorPort,
} from "@langwatch/evaluation-server";
import type { WorkflowService } from "@langwatch/workflow-contract";
import { resolveInputsMarker } from "~/server/app-layer/evaluations/evaluation-inputs-offload";
import { createStoredObjectsService } from "~/server/stored-objects/stored-objects-factory";

type EvaluationExecutionInput = Parameters<EvaluationExecutionPort["execute"]>[0];
type EvaluationExecutionOutput = Awaited<
  ReturnType<EvaluationExecutionPort["execute"]>
>;

/**
 * Process-owned Evaluation composition. The App root supplies infrastructure
 * and canonical feature capabilities once; request handlers and workers use
 * the resulting EvaluationService from App context.
 */
export type AppEvaluationRuntimeOptions = {
  resolveClickHouse: EvaluationClickHouseResolver;
  retentionFloor: EvaluationRetentionFloorPort;
  execution: EvaluationExecutionPort;
  inputResolution?: EvaluationInputsResolutionPort;
  workflows: WorkflowService;
};

/** App infrastructure adapter for ADR-040 durable Evaluation inputs. */
export class AppEvaluationInputsResolutionPort
  extends EvaluationInputsResolutionPort
{
  static create(): AppEvaluationInputsResolutionPort {
    return new AppEvaluationInputsResolutionPort();
  }

  private constructor() {
    super();
  }

  resolve(input: {
    tenantId: string;
    inputs: Record<string, unknown> | null;
  }): Promise<Record<string, unknown> | null> {
    return resolveInputsMarker({
      projectId: input.tenantId,
      inputs: input.inputs,
      storedObjects: createStoredObjectsService({ projectId: input.tenantId }),
    });
  }
}

/** Adapts the existing trace/evaluator engine at the process boundary. */
export class AppEvaluationExecutionPort extends EvaluationExecutionPort {
  static create(
    execute: (
      input: EvaluationExecutionInput,
    ) => Promise<EvaluationExecutionOutput>,
  ): AppEvaluationExecutionPort {
    return new AppEvaluationExecutionPort(execute);
  }

  private constructor(
    private readonly executeEvaluation: (
      input: EvaluationExecutionInput,
    ) => Promise<EvaluationExecutionOutput>,
  ) {
    super();
  }

  execute(input: EvaluationExecutionInput): Promise<EvaluationExecutionOutput> {
    return this.executeEvaluation(input);
  }
}

export class AppEvaluationRuntime {
  private constructor(private readonly options: AppEvaluationRuntimeOptions) {}

  static create(options: AppEvaluationRuntimeOptions): AppEvaluationRuntime {
    return new AppEvaluationRuntime(options);
  }

  build(): EvaluationService {
    return EvaluationAdapter.create({
      ...this.options,
      inputResolution:
        this.options.inputResolution ??
        AppEvaluationInputsResolutionPort.create(),
    });
  }
}
