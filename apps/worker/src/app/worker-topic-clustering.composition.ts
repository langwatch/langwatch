import { histogram } from "@langwatch/observability/metrics";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import { ModelProviderExecutionAdapter } from "@langwatch/model-provider-server";
import type {
  BatchClusteringParams,
  IncrementalClusteringParams,
  TopicClusteringProviderConfig,
} from "@langwatch/topic-contract";
import { TopicClusteringModelsPort } from "@langwatch/topic-contract";
import {
  OtelTopicClusteringMetricsAdapter,
  TopicClusteringLangevalsPort,
  type TopicClusteringClickHouseResolver,
  type TopicClusteringExecutionDependencies,
  type TopicClusteringLangevalsKind,
  type TopicClusteringLangevalsResponse,
} from "@langwatch/topic-server";
import type { WorkerConfig } from "../platform/config/worker.config";
import type { WorkerTopicCompositionOptions } from "./worker-production.composition";

/** The series name the App writes for the same measurement, pinned. */
export const TOPIC_CLUSTERING_PAYLOAD_SIZE_METRIC_NAME = "payload_size_bytes";

/**
 * Reports the composition decision an unresolvable model would otherwise hide. The clustering
 * pipeline mounts either way, so all nine of its routing keys stay claimed, the schedule advances,
 * and every command and projection is real. What is absent is the page RUN.
 */
export abstract class WorkerTopicAbsenceReportPort {
  abstract withoutClusteringModels(): void;
}

export type WorkerTopicClusteringOptions = Readonly<{
  config: WorkerConfig;
  /** The deployment's tenant-keyed ClickHouse client. */
  resolveClickHouseClient: TopicClusteringClickHouseResolver;
  /**
   * The model gateway this process composed, when it composed one. The SAME instance the evaluation
   * path resolves its `X_LITELLM_*` environment through — see `worker-model-
   * provider.composition.ts`.
   */
  modelProviders?: ModelProviderService;
  absence?: WorkerTopicAbsenceReportPort;
  /** Injected by the mount test; the process's own `fetch` otherwise. */
  fetch?: typeof globalThis.fetch;
}>;

/**
 * Topic clustering's execution ports, composed from this process's own
 * substrates: the tenant-keyed ClickHouse client, the packaged model
 * gateway, and a direct langevals POST with no S3 staging.
 */
export function createWorkerTopicClusteringExecution(
  options: WorkerTopicClusteringOptions,
): TopicClusteringExecutionDependencies {
  if (!options.modelProviders) options.absence?.withoutClusteringModels();
  const payloadSize = histogram({
    name: TOPIC_CLUSTERING_PAYLOAD_SIZE_METRIC_NAME,
    description: "Size of a request payload in bytes",
  });

  return {
    resolveClickHouseClient: options.resolveClickHouseClient,
    models: options.modelProviders
      ? ModelProviderExecutionAdapter.create({ modelProviders: options.modelProviders })
      : new AbsentTopicClusteringModels(),
    langevals: WorkerTopicClusteringLangevalsAdapter.create(
      options.fetch ?? ((input, init) => globalThis.fetch(input, init)),
    ),
    langevalsEndpoint: options.config.langevals.endpoint ?? null,
    observePayloadSize(kind: TopicClusteringLangevalsKind, sizeBytes: number): void {
      payloadSize.observe(sizeBytes, { endpoint: kind });
    },
  };
}

/**
 * The Topic feature's worker-owned runtime dependencies, minus the two the caller holds. `database`
 * and `redis` stay the composition root's because a process opens exactly one of each; `execution`
 * and `metrics` are composed here.
 */
export function createWorkerTopicRuntime(
  options: WorkerTopicClusteringOptions & {
    database: WorkerTopicCompositionOptions["database"];
    redis: WorkerTopicCompositionOptions["redis"];
  },
): WorkerTopicCompositionOptions {
  return {
    database: options.database,
    redis: options.redis,
    execution: createWorkerTopicClusteringExecution(options),
    metrics: OtelTopicClusteringMetricsAdapter.create(),
  };
}

/**
 * Topic's langevals exchange, posted directly.
 */
export class WorkerTopicClusteringLangevalsAdapter extends TopicClusteringLangevalsPort {
  static create(fetchImpl: typeof globalThis.fetch): WorkerTopicClusteringLangevalsAdapter {
    return new WorkerTopicClusteringLangevalsAdapter(fetchImpl);
  }

  private constructor(private readonly fetchImpl: typeof globalThis.fetch) {
    super();
  }

  async postClustering(params: {
    url: string;
    body: BatchClusteringParams | IncrementalClusteringParams;
    projectId: string;
    kind: TopicClusteringLangevalsKind;
    signal?: AbortSignal;
  }): Promise<TopicClusteringLangevalsResponse> {
    return this.fetchImpl(params.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params.body),
      ...(params.signal ? { signal: params.signal } : {}),
    });
  }
}

/**
 * What answers when this process composed no model gateway. All four methods resolve through the
 * customer's own model-provider configuration — which provider is enabled for the clustering
 * feature, which embeddings model it names, and the decrypted credentials LiteLLM is handed.
 */
class AbsentTopicClusteringModels extends TopicClusteringModelsPort {
  resolveClusteringModel(projectId: string): Promise<never> {
    return Promise.reject(new TopicClusteringModelsUnavailableError(projectId));
  }

  findExecutionProviders(projectId: string): Promise<never> {
    return Promise.reject(new TopicClusteringModelsUnavailableError(projectId));
  }

  resolveEmbeddingsModel(projectId: string): Promise<never> {
    return Promise.reject(new TopicClusteringModelsUnavailableError(projectId));
  }

  prepareLitellmParams(params: {
    model: string;
    modelProvider: TopicClusteringProviderConfig;
    projectId: string;
  }): Promise<never> {
    return Promise.reject(new TopicClusteringModelsUnavailableError(params.projectId));
  }
}

/** Named so a stalled clustering schedule reads as a composition decision. */
export class TopicClusteringModelsUnavailableError extends Error {
  readonly name = "TopicClusteringModelsUnavailableError";

  constructor(projectId: string) {
    super(
      `This process cannot resolve a clustering model for project ${projectId}: topic clustering runs on the project's own model provider, and this process composed no model gateway to read it through.`,
    );
  }
}
