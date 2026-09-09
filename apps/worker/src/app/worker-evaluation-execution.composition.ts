import { AZURE_SAFETY_PROVIDER_KEY } from "@langwatch/evaluation-contract";
import {
  EvaluationAzureSafetyCredentialsPort,
  EvaluationInputsOffloadPort,
  EvaluationMonitorLookupPort,
  type EvaluationInputsOffloadService,
  EvaluationSettingsRecoveryPort,
  EvaluationSpanDigestPort,
  EvaluationTraceEvidencePort,
  EvaluationTraceReadPort,
  type EvaluationTraceProtections,
  EvaluationWorkflowExecutorPort,
  HttpLangevalsEvaluatorAdapter,
  OtelEvaluationExecutionMetricsAdapter,
  EvaluationCostService,
} from "@langwatch/evaluation-server";
import {
  NlpEvaluatorCodeExecutionAdapter,
  PostgresEvaluatorAdapter,
} from "@langwatch/evaluator-server";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import { getProjectModelProviders } from "@langwatch/model-provider-server";
import { AuthzApi } from "@langwatch/authz-contract";
import { PrismaEvaluationCostRepository } from "@langwatch/evaluation-server/composition/evaluation-cost";
import type { MonitorApi, MonitorIdInput, MonitorWithEvaluator } from "@langwatch/monitor-contract";
import {
  monitorServer,
  MonitorEvaluatorPort,
  MonitorPerformancePort,
  MonitorReplicationPort,
} from "@langwatch/monitor-server";
import { createApp, type ResourceOwnership } from "@langwatch/runtime-composition";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { EvaluationTraceReadInput, Span, TraceApi } from "@langwatch/trace-contract";
import { TraceReadableSpanService } from "@langwatch/trace-server";
import { WorkflowEvaluationAdapter } from "@langwatch/evaluation-server/workflow-evaluation";
import type { SingleEvaluationResult } from "@langwatch/evaluator-contract";
import { nanoid } from "nanoid";
import {
  createWorkerEvaluationInputsOffload,
  type WorkerEvaluationWorkflows,
} from "./worker-evaluation-app.composition.ts";
import { createWorkerEvaluationModelEnv } from "./worker-evaluation-model-env.composition.ts";
import type { WorkerModelProviders } from "./worker-model-provider.composition.ts";
import type { WorkerObjectStorage } from "./worker-object-storage.composition.ts";
import type { WorkerEvaluationExecutionCollaborators } from "./worker-evaluation-processing.composition.ts";

const LANGEVALS_MAX_RETRIES = 1;
const LANGEVALS_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Composes every external collaborator of Evaluation's durable execution
 * intent. The same Workflow API, input-offload service, and model gateway are
 * handed to all branches so the direct API and queued command agree.
 */
export function createWorkerEvaluationExecutionCollaborators(input: {
  database: PrismaClient;
  traces: TraceApi;
  /** The ONE monitor application this process installed. */
  monitors: MonitorApi;
  workflows: WorkerEvaluationWorkflows;
  models: WorkerModelProviders;
  featureFlags: FeatureFlagApi;
  storage: WorkerObjectStorage;
  langevalsEndpoint: string | undefined;
  environment: Readonly<Record<string, string | undefined>>;
}): WorkerEvaluationExecutionCollaborators &
  Readonly<{ inputResolution: EvaluationInputsOffloadService }> {
  const inputs = createWorkerEvaluationInputsOffload({ storage: input.storage });
  const traceReads = WorkerEvaluationTraceReads.create(input.traces);
  const azureSafetyCredentials = WorkerEvaluationAzureSafetyCredentials.create({
    modelProviders: input.models.modelProviders,
  });
  const telemetry = OtelEvaluationExecutionMetricsAdapter.create();
  const evaluators = PostgresEvaluatorAdapter.create({
    database: input.database,
    workflows: input.workflows.workflows,
    codeExecution: NlpEvaluatorCodeExecutionAdapter.create(input.workflows.nlpRuntime),
    generateId: nanoid,
  });

  return {
    monitors: new WorkerEvaluationMonitorLookup(input.monitors),
    evidence: WorkerEvaluationTraceEvidence.create(input.traces),
    azureSafetyCredentials,
    settingsRecovery: WorkerEvaluationSettingsRecovery.create(input.featureFlags),
    inputsOffload: WorkerEvaluationInputsOffload.create({
      inputs,
      flags: input.featureFlags,
    }),
    inputResolution: inputs,
    costs: EvaluationCostService.create({
      repository: PrismaEvaluationCostRepository.create({ prisma: input.database }),
    }),
    engine: {
      traceService: traceReads,
      spanDigest: WorkerEvaluationSpanDigest.create(),
      modelEnvResolver: createWorkerEvaluationModelEnv({
        models: input.models,
        azureSafetyCredentials,
        environment: input.environment,
      }),
      langevalsClient: HttpLangevalsEvaluatorAdapter.create({
        config: {
          endpoint: input.langevalsEndpoint,
          maxRetries: LANGEVALS_MAX_RETRIES,
          timeoutMs: LANGEVALS_TIMEOUT_MS,
        },
        telemetry,
      }),
      workflows: input.workflows.workflows,
      evaluators,
      workflowExecutor: WorkerEvaluationWorkflowExecutor.create(input.workflows),
      installEnvironment: input.environment,
      telemetry,
    },
  };
}

/**
 * The monitor application, installed for the ONE read Evaluation's execution
 * makes: the monitor a queued command names.
 *
 * The worker composes no evaluator directory, no seven-day trend and no
 * replication, so the operations that read them refuse by name. `findById`,
 * which is the only one this process calls, answers from the monitor rows.
 */
export async function createWorkerMonitorApp(options: {
  database: PrismaClient;
  permissions: AuthzApi;
  resources: ResourceOwnership;
}): Promise<MonitorApi> {
  const runtime = await createApp({ name: "langwatch-worker-monitor" })
    .withPersistence("postgres", { prisma: options.database })
    .withInfrastructure({})
    .withProvided(AuthzApi, options.permissions)
    .withModule(monitorServer, {
      infrastructure: {
        evaluators: new UncomposedMonitorEvaluators(),
        performance: new UncomposedMonitorPerformance(),
        replication: new UncomposedMonitorReplication(),
        generateId: () => `monitor_${nanoid()}`,
      },
    })
    .boot({ role: "worker" });

  options.resources.own("worker monitor application", () => runtime.stop());

  return runtime.module(monitorServer).provided;
}

/** A monitor read this process makes, over the one monitor application. */
class WorkerEvaluationMonitorLookup extends EvaluationMonitorLookupPort {
  constructor(private readonly monitors: MonitorApi) {
    super();
  }

  async tryGetMonitorById(input: MonitorIdInput): Promise<MonitorWithEvaluator | null> {
    return (await this.monitors.findById(input)) ?? null;
  }
}

const uncomposedInWorker = (capability: string): Error =>
  new Error(`The worker composed no ${capability}, so this monitor operation cannot answer.`);

class UncomposedMonitorEvaluators extends MonitorEvaluatorPort {
  getById(): Promise<never> {
    return Promise.reject(uncomposedInWorker("evaluator directory"));
  }

  archive(): Promise<never> {
    return Promise.reject(uncomposedInWorker("evaluator directory"));
  }
}

class UncomposedMonitorPerformance extends MonitorPerformancePort {
  getMonitorPerformance(): Promise<never> {
    return Promise.reject(uncomposedInWorker("online-evaluation trend"));
  }

  previousPeriodStartMs(): number {
    throw uncomposedInWorker("online-evaluation trend");
  }
}

class UncomposedMonitorReplication extends MonitorReplicationPort {
  copyEvaluatorToProject(): Promise<never> {
    return Promise.reject(uncomposedInWorker("evaluator replication"));
  }

  deleteReplicatedWorkflow(): Promise<never> {
    return Promise.reject(uncomposedInWorker("evaluator replication"));
  }
}

class WorkerEvaluationAzureSafetyCredentials extends EvaluationAzureSafetyCredentialsPort {
  static create(input: {
    modelProviders: ModelProviderService;
  }): WorkerEvaluationAzureSafetyCredentials {
    return new WorkerEvaluationAzureSafetyCredentials(input.modelProviders);
  }

  #modelProviders: ModelProviderService;

  private constructor(modelProviders: ModelProviderService) {
    super();
    this.#modelProviders = modelProviders;
  }

  async tryGetForTenant(input: { tenantId: string }): Promise<Record<string, string> | null> {
    const providers = await getProjectModelProviders(this.#modelProviders, input.tenantId);
    const provider = providers[AZURE_SAFETY_PROVIDER_KEY];
    if (!provider?.enabled) return null;

    const endpoint = provider.customKeys?.AZURE_CONTENT_SAFETY_ENDPOINT;
    const key = provider.customKeys?.AZURE_CONTENT_SAFETY_KEY;
    if (typeof endpoint !== "string" || endpoint.trim() === "") return null;
    if (typeof key !== "string" || key.trim() === "") return null;

    return {
      AZURE_CONTENT_SAFETY_ENDPOINT: endpoint,
      AZURE_CONTENT_SAFETY_KEY: key,
    };
  }
}

/** Evaluation's full-content trace reads through Trace's composed API. */
class WorkerEvaluationTraceReads extends EvaluationTraceReadPort {
  static create(traces: TraceApi): WorkerEvaluationTraceReads {
    return new WorkerEvaluationTraceReads(traces);
  }

  #traces: TraceApi;

  private constructor(traces: TraceApi) {
    super();
    this.#traces = traces;
  }

  getTracesWithSpans(
    projectId: string,
    traceIds: string[],
    protections: EvaluationTraceProtections,
    occurredAt?: { from: number; to: number },
    opts?: { full?: boolean; withEditOverlay?: boolean },
  ) {
    return this.#traces.readTracesWithSpans({
      projectId,
      traceIds,
      protections,
      ...(occurredAt ? { occurredAt } : {}),
      ...(opts?.withEditOverlay === undefined ? {} : { withEditOverlay: opts.withEditOverlay }),
    });
  }

  getEvaluationsMultiple(
    projectId: string,
    traceIds: string[],
    protections: EvaluationTraceProtections,
  ): Promise<Record<string, unknown[]>> {
    return this.#traces.readEvaluations({ projectId, traceIds, protections });
  }

  getTracesWithSpansByThreadIds(
    projectId: string,
    threadIds: string[],
    protections: EvaluationTraceProtections,
    opts?: { full?: boolean; withEditOverlay?: boolean },
  ) {
    return this.#traces.readThreadsTraces({
      projectId,
      threadIds,
      protections,
      ...(opts?.withEditOverlay === undefined ? {} : { withEditOverlay: opts.withEditOverlay }),
    });
  }
}

class WorkerEvaluationTraceEvidence extends EvaluationTraceEvidencePort {
  static create(traces: TraceApi): WorkerEvaluationTraceEvidence {
    return new WorkerEvaluationTraceEvidence(traces);
  }

  #traces: TraceApi;

  private constructor(traces: TraceApi) {
    super();
    this.#traces = traces;
  }

  getEvaluationSpans(input: EvaluationTraceReadInput) {
    return this.#traces.getEvaluationSpans(input);
  }

  getEvaluationEvents(input: EvaluationTraceReadInput) {
    return this.#traces.getEvaluationEvents(input);
  }
}

class WorkerEvaluationSettingsRecovery extends EvaluationSettingsRecoveryPort {
  static create(flags: FeatureFlagApi): WorkerEvaluationSettingsRecovery {
    return new WorkerEvaluationSettingsRecovery(flags);
  }

  #flags: FeatureFlagApi;

  private constructor(flags: FeatureFlagApi) {
    super();
    this.#flags = flags;
  }

  async isDisabled(): Promise<boolean> {
    return this.#flags.isEnabled("ops_evaluator_settings_recovery_disabled", { kind: "system" });
  }
}

class WorkerEvaluationInputsOffload extends EvaluationInputsOffloadPort {
  static create(input: {
    inputs: EvaluationInputsOffloadService;
    flags: FeatureFlagApi;
  }): WorkerEvaluationInputsOffload {
    return new WorkerEvaluationInputsOffload(input.inputs, input.flags);
  }

  #inputs: EvaluationInputsOffloadService;
  #flags: FeatureFlagApi;

  private constructor(inputs: EvaluationInputsOffloadService, flags: FeatureFlagApi) {
    super();
    this.#inputs = inputs;
    this.#flags = flags;
  }

  async offload(input: {
    tenantId: string;
    evaluationId: string;
    inputs: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    const disabled = await this.#flags.isEnabled("ops_evaluation_payload_offload_disabled", {
      kind: "system",
    });
    return disabled ? input.inputs : this.#inputs.offload(input);
  }
}

class WorkerEvaluationSpanDigest extends EvaluationSpanDigestPort {
  static create(): WorkerEvaluationSpanDigest {
    return new WorkerEvaluationSpanDigest();
  }

  private constructor() {
    super();
  }

  format(spans: Span[]): Promise<string> {
    return TraceReadableSpanService.formatSpansDigest(spans);
  }
}

class WorkerEvaluationWorkflowExecutor extends EvaluationWorkflowExecutorPort {
  static create(workflows: WorkerEvaluationWorkflows): WorkerEvaluationWorkflowExecutor {
    return new WorkerEvaluationWorkflowExecutor(
      WorkflowEvaluationAdapter.create(workflows.workflows),
    );
  }

  #workflows: WorkflowEvaluationAdapter;

  private constructor(workflows: WorkflowEvaluationAdapter) {
    super();
    this.#workflows = workflows;
  }

  runEvaluationWorkflow(
    workflowId: string,
    projectId: string,
    inputs: Record<string, string>,
    versionId?: string,
    causalityDepth?: number,
    parentTrace?: { traceId: string; parentSpanId: string },
  ): Promise<{ result: SingleEvaluationResult; status: string }> {
    return this.#workflows.run({
      workflowId,
      projectId,
      inputs,
      ...(versionId === undefined ? {} : { versionId }),
      ...(causalityDepth === undefined ? {} : { causalityDepth }),
      ...(parentTrace === undefined ? {} : { parentTrace }),
    });
  }
}
