import type {
  EvaluationExecutionResult,
  EvaluationService,
  ExecuteEvaluationCommand,
} from "@langwatch/evaluation-contract";
import type { SingleEvaluationResult } from "@langwatch/evaluator-contract";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import {
  EvaluationAdapter,
  EvaluationExecutionPort,
  EvaluationAzureSafetyCredentialsPort,
  EvaluationInputOffloadAvailabilityPort,
  EvaluationInputStoragePort,
  EvaluationInputsResolutionPort,
  EvaluationInputsOffloadPort,
  EvaluationInputsOffloadService,
  EVAL_INPUTS_STORED_OBJECT_PURPOSE,
  type EvaluationInputOffloadConfig,
  EvaluationSettingsRecoveryPort,
  type EvaluationClickHouseResolver,
  type EvaluationRetentionFloorPort,
} from "@langwatch/evaluation-server";
import { getAzureSafetyEnvFromProject } from "~/server/app-layer/evaluations/azure-safety-env.server";
import { WorkflowEvaluationAdapter } from "@langwatch/evaluation-server/workflow-evaluation";
import type { ExecutionStatus, WorkflowService } from "@langwatch/workflow-contract";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type { StoredObjectsService } from "~/server/stored-objects/stored-objects.service";

export {
  EVAL_INPUTS_HARD_CEILING_BYTES,
  EVAL_INPUTS_INLINE_MAX_BYTES,
  EVAL_INPUTS_PREVIEW_BYTES,
  EVAL_INPUTS_STORED_OBJECT_PURPOSE,
  EvaluationInputStoragePort,
  EvaluationInputsOffloadService,
  isStoredObjectMarker,
  STORED_OBJECT_MARKER_KEY,
} from "@langwatch/evaluation-server";

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
  featureFlags: FeatureFlagService;
  storedObjects: StoredObjectsService;
  inputsOffloadConfig: EvaluationInputOffloadConfig;
};

export type AppEvaluationExecutionControls = {
  settingsRecovery: EvaluationSettingsRecoveryPort;
  inputsOffload: EvaluationInputsOffloadPort;
};

/** App infrastructure adapter for ADR-040 durable Evaluation inputs. */
export class AppEvaluationInputsResolutionPort extends EvaluationInputsResolutionPort {
  static create(
    storedObjects: StoredObjectsService,
    config: EvaluationInputOffloadConfig,
  ): AppEvaluationInputsResolutionPort {
    return new AppEvaluationInputsResolutionPort(
      EvaluationInputsOffloadService.create({
        storage: AppEvaluationInputStoragePort.create(storedObjects),
        config,
      }),
    );
  }

  private constructor(private readonly service: EvaluationInputsOffloadService) {
    super();
  }

  tryResolve(input: {
    tenantId: string;
    inputs: Record<string, unknown> | null;
  }): Promise<Record<string, unknown> | null> {
    return this.service.tryResolve(input);
  }
}

class AppEvaluationInputStoragePort extends EvaluationInputStoragePort {
  static create(storedObjects: StoredObjectsService): AppEvaluationInputStoragePort {
    return new AppEvaluationInputStoragePort(storedObjects);
  }

  private constructor(private readonly storedObjects: StoredObjectsService) {
    super();
  }

  async store(input: {
    tenantId: string;
    evaluationId: string;
    bytes: Uint8Array;
  }): Promise<{ id: string }> {
    const stored = await this.storedObjects.storeFromBytes({
      projectId: input.tenantId,
      purpose: EVAL_INPUTS_STORED_OBJECT_PURPOSE,
      ownerKind: "evaluation",
      ownerId: input.evaluationId,
      mediaType: "application/json",
      bytes: Buffer.from(input.bytes),
    });
    return { id: stored.id };
  }

  async tryRead(input: {
    tenantId: string;
    id: string;
  }): Promise<AsyncIterable<Uint8Array> | null> {
    const result = await this.storedObjects.getById({
      projectId: input.tenantId,
      id: input.id,
    });
    if (!result || !("stream" in result)) return null;
    return readStoredObjectStream(result.stream);
  }
}

async function* readStoredObjectStream(
  stream: AsyncIterable<Uint8Array>,
): AsyncIterable<Uint8Array> {
  for await (const chunk of stream) yield chunk;
}

class AppEvaluationInputOffloadAvailabilityPort extends EvaluationInputOffloadAvailabilityPort {
  static create(featureFlags: FeatureFlagService): AppEvaluationInputOffloadAvailabilityPort {
    return new AppEvaluationInputOffloadAvailabilityPort(featureFlags);
  }

  private constructor(private readonly featureFlags: FeatureFlagService) {
    super();
  }

  async isDisabled(): Promise<boolean> {
    try {
      return await this.featureFlags.isEnabled("ops_evaluation_payload_offload_disabled", {
        kind: "system",
      });
    } catch {
      return false;
    }
  }
}

export class AppEvaluationAzureSafetyCredentialsPort extends EvaluationAzureSafetyCredentialsPort {
  static create(modelProviders: ModelProviderService): AppEvaluationAzureSafetyCredentialsPort {
    return new AppEvaluationAzureSafetyCredentialsPort(modelProviders);
  }

  private constructor(private readonly modelProviders: ModelProviderService) {
    super();
  }

  tryGetForTenant(input: { tenantId: string }): Promise<Record<string, string> | null> {
    return getAzureSafetyEnvFromProject(this.modelProviders, input.tenantId);
  }
}

export class AppEvaluationSettingsRecoveryPort extends EvaluationSettingsRecoveryPort {
  static create(featureFlags: FeatureFlagService): AppEvaluationSettingsRecoveryPort {
    return new AppEvaluationSettingsRecoveryPort(featureFlags);
  }

  private constructor(private readonly featureFlags: FeatureFlagService) {
    super();
  }

  async isDisabled(): Promise<boolean> {
    try {
      return await this.featureFlags.isEnabled("ops_evaluator_settings_recovery_disabled", {
        kind: "system",
      });
    } catch {
      return false;
    }
  }
}

/** App composition bridge for Evaluation-owned input offload policy. */
export class AppEvaluationInputsOffloadPort extends EvaluationInputsOffloadPort {
  static create(
    storedObjects: StoredObjectsService,
    config: EvaluationInputOffloadConfig,
    featureFlags: FeatureFlagService,
  ): AppEvaluationInputsOffloadPort {
    return new AppEvaluationInputsOffloadPort(
      EvaluationInputsOffloadService.create({
        storage: AppEvaluationInputStoragePort.create(storedObjects),
        config,
      }),
      AppEvaluationInputOffloadAvailabilityPort.create(featureFlags),
    );
  }

  private constructor(
    private readonly service: EvaluationInputsOffloadService,
    private readonly availability: EvaluationInputOffloadAvailabilityPort,
  ) {
    super();
  }

  async offload(input: {
    tenantId: string;
    evaluationId: string;
    inputs: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    if (await this.availability.isDisabled()) return input.inputs;
    return this.service.offload(input);
  }
}

/** Adapts the existing trace/evaluator engine at the process boundary. */
export class AppEvaluationExecutionPort extends EvaluationExecutionPort {
  static create(
    execute: (input: ExecuteEvaluationCommand) => Promise<EvaluationExecutionResult>,
  ): AppEvaluationExecutionPort {
    return new AppEvaluationExecutionPort(execute);
  }

  private constructor(
    private readonly executeEvaluation: (
      input: ExecuteEvaluationCommand,
    ) => Promise<EvaluationExecutionResult>,
  ) {
    super();
  }

  execute(input: ExecuteEvaluationCommand): Promise<EvaluationExecutionResult> {
    return this.executeEvaluation(input);
  }
}

/** Composition adapter for the legacy Evaluation execution engine's workflow port. */
export class AppWorkflowEvaluationAdapter {
  static create(workflows: WorkflowService): AppWorkflowEvaluationAdapter {
    return new AppWorkflowEvaluationAdapter(workflows);
  }

  private constructor(private readonly workflows: WorkflowService) {}

  runEvaluationWorkflow(
    workflowId: string,
    projectId: string,
    inputs: Record<string, string>,
    versionId?: string,
    causalityDepth?: number,
    parentTrace?: { traceId: string; parentSpanId: string },
  ): Promise<{ result: SingleEvaluationResult; status: ExecutionStatus }> {
    return WorkflowEvaluationAdapter.create(this.workflows).run({
      workflowId,
      projectId,
      inputs,
      versionId,
      causalityDepth,
      parentTrace,
    });
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
        AppEvaluationInputsResolutionPort.create(
          this.options.storedObjects,
          this.options.inputsOffloadConfig,
        ),
    });
  }

  buildExecutionControls(): AppEvaluationExecutionControls {
    return {
      settingsRecovery: AppEvaluationSettingsRecoveryPort.create(this.options.featureFlags),
      inputsOffload: AppEvaluationInputsOffloadPort.create(
        this.options.storedObjects,
        this.options.inputsOffloadConfig,
        this.options.featureFlags,
      ),
    };
  }
}
