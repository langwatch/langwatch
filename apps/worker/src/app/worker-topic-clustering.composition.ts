import { histogram, type HistogramHandle } from "@langwatch/observability/metrics";
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
 * Reports the composition decision an unresolvable model would otherwise hide.
 *
 * The clustering pipeline mounts either way, so all nine of its routing keys
 * stay claimed, the schedule advances, and every command and projection is
 * real. What is absent is the page RUN.
 *
 * It is reported only when this process composed no model gateway. A process
 * that composed one resolves all four questions through it and reports
 * nothing — the absence names a deployment, not a permanent shape.
 */
export abstract class WorkerTopicAbsenceReportPort {
  abstract withoutClusteringModels(): void;
}

export type WorkerTopicClusteringOptions = Readonly<{
  config: WorkerConfig;
  /** The deployment's tenant-keyed ClickHouse client. */
  resolveClickHouseClient: TopicClusteringClickHouseResolver;
  /**
   * The model gateway this process composed, when it composed one.
   *
   * The SAME instance the evaluation path resolves its `X_LITELLM_*`
   * environment through — see `worker-model-provider.composition.ts`. Two
   * gateways would be two decryptions of one stored credential and two answers
   * to which model a project clusters with.
   */
  modelProviders?: ModelProviderService;
  absence?: WorkerTopicAbsenceReportPort;
  /** Injected by the mount test; the process's own `fetch` otherwise. */
  fetch?: typeof globalThis.fetch;
}>;

/**
 * Topic clustering's execution ports, composed from this process's own
 * substrates.
 *
 *     resolveClickHouseClient  the event store's own tenant-keyed client
 *     models                   the model gateway, through the packaged
 *                              ModelProviderExecutionAdapter — or ABSENT on a
 *                              process that composed no gateway
 *     langevals                a direct POST, no S3 staging
 *     langevalsEndpoint        LANGEVALS_ENDPOINT
 *     observePayloadSize       payload_size_bytes, over OTLP
 *
 * THE MODELS PORT IS THE PACKAGE'S OWN. `ModelProviderExecutionAdapter` in
 * `@langwatch/model-provider-server` implements all four methods over
 * `ModelProviderService` — it is the same adapter the application composes —
 * so nothing here re-derives which model a project clusters with, which
 * embeddings model it names, or what LiteLLM is handed. This composition only
 * says which gateway instance answers.
 *
 * THE LANGEVALS TRANSPORT IS DELIBERATELY DIFFERENT from the application's,
 * and the difference is named rather than hidden. The App posts through a
 * staging client that spills anything past a threshold to S3 and hands
 * langevals a presigned URL, because langevals runs on Lambda and Lambda
 * hard-caps a synchronous invoke at 6 MB. This process posts the body
 * directly. A page larger than that cap therefore fails with the transport's
 * own error instead of succeeding over S3 — which is a loud failure on the
 * page that was too big, not a wrong clustering on every page. Staging is
 * reachable work, not impossible work; it is left out because the run above
 * it cannot happen yet, and building a transport for a caller that refuses
 * would be a second thing to keep aligned with nothing exercising it.
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
 * The Topic feature's worker-owned runtime dependencies, minus the two the
 * caller holds.
 *
 * `database` and `redis` stay the composition root's because a process opens
 * exactly one of each; `execution` and `metrics` are composed here.
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
 *
 * The `TopicClusteringLangevalsResponse` shape is a slice of `Response`, so the
 * fetch result satisfies it as-is and no body is read here — the runner owns
 * whether it wants `text()` or `json()`, and reading either eagerly would
 * consume a multi-megabyte clustering result this class has no use for.
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
 * What answers when this process composed no model gateway.
 *
 * All four methods resolve through the customer's own model-provider
 * configuration — which provider is enabled for the clustering feature, which
 * embeddings model it names, and the decrypted credentials LiteLLM is handed.
 * That cascade is `ModelProviderService`, which this process CAN now compose
 * (`worker-model-provider.composition.ts`); what a deployment can still be
 * missing is one of its preconditions — the database, the tenancy graph, or
 * the stored-secret cipher every provider credential is encrypted under.
 *
 * REFUSING BEATS DEFAULTING, and by a long way. A clustering run that fell
 * back to some built-in model would name a customer's topics with a provider
 * they never chose and bill it to a key they never gave us; worse, the result
 * is written into the topic model and read back as theirs. The page fails
 * instead, `classifyClusteringError` sees a plain error, the outbox retries
 * with backoff, and the schedule keeps its place.
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
