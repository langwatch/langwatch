import { createHash } from "node:crypto";
import type { AwsClientProcessRuntime } from "@langwatch/aws-client";
import type { EventingClickHouseClientResolver } from "@langwatch/eventing/server";
import type { ResourceOwnership } from "@langwatch/runtime-composition";
import {
  EVAL_INPUTS_HARD_CEILING_BYTES,
  EVAL_INPUTS_INLINE_MAX_BYTES,
  EVAL_INPUTS_PREVIEW_BYTES,
  EvaluationExecutionPort,
  EvaluationInputStoragePort,
  EvaluationInputsOffloadService,
  type EvaluationInputsResolutionPort,
  EvaluationRetentionFloorPort,
  type EvaluationClickHouseClient,
  type EvaluationClickHouseResolver,
} from "@langwatch/evaluation-server";
import { EvaluationApp } from "@langwatch/evaluation-server";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { DatasetApi } from "@langwatch/dataset-contract";
import {
  ContractWorkflowDslMigrationAdapter,
  HttpWorkflowNlpRuntimeAdapter,
  NlpPayloadStagingPort,
  PostgresWorkflowAdapter,
  PrismaWorkflowProjectEnvironmentAdapter,
  UnconfiguredWorkflowNlpRuntimeAdapter,
  WorkflowLlmParametersPort,
  type WorkflowEnvironmentDecryptor,
  type WorkflowLlmParameterResolution,
  type WorkflowNlpRuntimePort,
} from "@langwatch/workflow-server";
import type { LLMConfig, WorkflowApi, WorkflowService } from "@langwatch/workflow-contract";
import type { TraceApi } from "@langwatch/trace-contract";
import { getProjectModelProviders } from "@langwatch/model-provider-server";
import { mintStoredObjectUri, ObjectNotFoundError } from "@langwatch/stored-object-contract";
import type { StoredObjectStorageRuntimeAdapter } from "@langwatch/stored-object-server";

/** The complete Evaluation read/write capability composed for the worker. */
export type WorkerEvaluationAppComposition = Readonly<{
  evaluations: EvaluationApp;
}>;

export type WorkerEvaluationWorkflowCompositionInput = Readonly<{
  database: PrismaClient;
  /** The ONE dataset application this process installed, read by the studio. */
  datasets: DatasetApi;
  modelProviders: ModelProviderService;
  secretDecryptor: WorkflowEnvironmentDecryptor;
  nlpServiceUrl: string | undefined;
  payloadStaging: NlpPayloadStagingPort;
}>;

export type WorkerEvaluationWorkflows = Readonly<{
  workflows: WorkflowService;
  nlpRuntime: WorkflowNlpRuntimePort;
}>;

/**
 * Builds the worker's one Workflow API before Evaluation's engine is
 * constructed. The engine and the Evaluation application both receive this
 * exact instance.
 */
export function createWorkerEvaluationWorkflows(
  input: WorkerEvaluationWorkflowCompositionInput,
): WorkerEvaluationWorkflows {
  const nlpRuntime = input.nlpServiceUrl
    ? HttpWorkflowNlpRuntimeAdapter.create({
        serviceUrl: input.nlpServiceUrl,
        staging: input.payloadStaging,
      })
    : UnconfiguredWorkflowNlpRuntimeAdapter.create();
  const workflows = PostgresWorkflowAdapter.create({
    database: input.database,
    datasets: input.datasets,
    modelProviders: input.modelProviders,
    nlpRuntime,
    projectEnvironment: PrismaWorkflowProjectEnvironmentAdapter.create({
      database: input.database,
      encryption: input.secretDecryptor,
    }),
    llmParameters: WorkerEvaluationWorkflowLlmParameters.create({
      modelProviders: input.modelProviders,
    }),
    dslMigration: ContractWorkflowDslMigrationAdapter.create(),
  });
  return { workflows, nlpRuntime };
}

/**
 * The real Evaluation application closure for the worker. Its evaluator
 * engine is supplied by Evaluation's durable processing graph, which owns the
 * one process instance; this function only adds the synchronous API boundary
 * around that same engine.
 */
export function createWorkerEvaluationApp(input: {
  resolveClickHouseClient: EventingClickHouseClientResolver;
  defaultRetentionDays: number;
  execution: EvaluationExecutionPort;
  workflows: WorkflowApi;
  traces: TraceApi;
  inputResolution: EvaluationInputsResolutionPort;
  resources: ResourceOwnership;
}): WorkerEvaluationAppComposition {
  return {
    evaluations: EvaluationApp.create({
      infrastructure: {
        resolveClickHouse: createWorkerEvaluationClickHouseResolver(input.resolveClickHouseClient),
        retentionFloor: WorkerEvaluationRetentionFloor.create(input.defaultRetentionDays),
        execution: input.execution,
        inputResolution: input.inputResolution,
      },
      dependencies: { workflows: input.workflows, traces: input.traces },
      config: undefined,
      resources: input.resources,
    }),
  };
}

/**
 * The shared offload/read service for Evaluation's event projection and API.
 * Both paths use the same marker format and tenant-routed storage location.
 */
export function createWorkerEvaluationInputsOffload(input: {
  storage: {
    runtime: StoredObjectStorageRuntimeAdapter;
    aws: AwsClientProcessRuntime;
  };
}): EvaluationInputsOffloadService {
  return EvaluationInputsOffloadService.create({
    storage: WorkerEvaluationInputStorage.create({
      runtime: input.storage.runtime,
      aws: input.storage.aws,
    }),
    config: {
      inlineMaxBytes: EVAL_INPUTS_INLINE_MAX_BYTES,
      hardCeilingBytes: EVAL_INPUTS_HARD_CEILING_BYTES,
      previewBytes: EVAL_INPUTS_PREVIEW_BYTES,
    },
  });
}

/** Narrows Eventing's tenant client at the one composition seam Evaluation owns. */
export function createWorkerEvaluationClickHouseResolver(
  resolve: EventingClickHouseClientResolver,
): EvaluationClickHouseResolver {
  return async (tenantId): Promise<EvaluationClickHouseClient> => {
    const client = await resolve(tenantId);
    return {
      query: ({ query, query_params, format }) => client.query({ query, query_params, format }),
      insert: ({ table, values, format, clickhouse_settings }) =>
        client.insert({
          table,
          values,
          format,
          clickhouse_settings: numericClickHouseSettings(clickhouse_settings),
        }),
    };
  };
}

function numericClickHouseSettings(
  settings: Record<string, unknown> | undefined,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(settings ?? {}).filter((entry): entry is [string, number] =>
      typeof entry[1] === "number" ? true : false,
    ),
  );
}

class WorkerEvaluationRetentionFloor extends EvaluationRetentionFloorPort {
  static create(defaultRetentionDays: number): WorkerEvaluationRetentionFloor {
    return new WorkerEvaluationRetentionFloor(defaultRetentionDays);
  }

  #defaultRetentionDays: number;

  private constructor(defaultRetentionDays: number) {
    super();
    this.#defaultRetentionDays = defaultRetentionDays;
  }

  async getFloorMs(): Promise<number> {
    return Date.now() - this.#defaultRetentionDays * 24 * 60 * 60 * 1000;
  }
}

/** Persists evaluation input blobs under the same tenant-routed object store as trace blobs. */
class WorkerEvaluationInputStorage extends EvaluationInputStoragePort {
  static create(input: {
    runtime: StoredObjectStorageRuntimeAdapter;
    aws: AwsClientProcessRuntime;
  }): WorkerEvaluationInputStorage {
    return new WorkerEvaluationInputStorage(input.runtime, input.aws);
  }

  #runtime: StoredObjectStorageRuntimeAdapter;
  #aws: AwsClientProcessRuntime;

  private constructor(runtime: StoredObjectStorageRuntimeAdapter, aws: AwsClientProcessRuntime) {
    super();
    this.#runtime = runtime;
    this.#aws = aws;
  }

  async store(input: {
    tenantId: string;
    evaluationId: string;
    bytes: Uint8Array;
  }): Promise<{ id: string }> {
    const id = this.idFor(input.evaluationId);
    const project = this.#runtime.forProject(input.tenantId, this.#aws);
    const destination = await project.resolveDestination();
    const uri = mintStoredObjectUri({
      destination,
      objectPath: `${input.tenantId}/evaluation-inputs/${id}.json`,
    });
    await project.objectStore.put(uri, Buffer.from(input.bytes), "application/json");
    return { id };
  }

  async tryRead(input: {
    tenantId: string;
    id: string;
  }): Promise<AsyncIterable<Uint8Array> | null> {
    if (!/^[a-f0-9]{64}$/u.test(input.id)) return null;

    const project = this.#runtime.forProject(input.tenantId, this.#aws);
    const destination = await project.resolveDestination();
    const uri = mintStoredObjectUri({
      destination,
      objectPath: `${input.tenantId}/evaluation-inputs/${input.id}.json`,
    });
    try {
      return this.bytes(await project.objectStore.get(uri));
    } catch (error) {
      if (error instanceof ObjectNotFoundError) return null;
      throw error;
    }
  }

  private idFor(evaluationId: string): string {
    return createHash("sha256").update(evaluationId).digest("hex");
  }

  private async *bytes(stream: AsyncIterable<Uint8Array | string>): AsyncIterable<Uint8Array> {
    for await (const chunk of stream) {
      yield typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    }
  }
}

class WorkerEvaluationWorkflowLlmParameters extends WorkflowLlmParametersPort {
  static create(input: {
    modelProviders: ModelProviderService;
  }): WorkerEvaluationWorkflowLlmParameters {
    return new WorkerEvaluationWorkflowLlmParameters(input.modelProviders);
  }

  #modelProviders: ModelProviderService;

  private constructor(modelProviders: ModelProviderService) {
    super();
    this.#modelProviders = modelProviders;
  }

  async resolve(input: {
    projectId: string;
    models: readonly LLMConfig["model"][];
  }): Promise<readonly WorkflowLlmParameterResolution[]> {
    const providers = await getProjectModelProviders(this.#modelProviders, input.projectId);

    return await Promise.all(
      input.models.map(async (model) => {
        const provider = model.split("/")[0]!;
        const modelProvider = providers[provider];
        if (!modelProvider) return { model, provider, configured: false, enabled: false };
        if (!modelProvider.enabled) return { model, provider, configured: true, enabled: false };

        return {
          model,
          provider,
          configured: true,
          enabled: true,
          litellmParams: await this.#modelProviders.prepareExecution({
            model,
            projectId: input.projectId,
          }),
        };
      }),
    );
  }
}
