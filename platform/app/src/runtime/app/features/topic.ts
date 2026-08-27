import type { ProcessStore } from "@langwatch/eventing";
import type { ManagedProviderService } from "@langwatch/enterprise-managed-provider-contract";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type {
  BatchClusteringParams,
  IncrementalClusteringParams,
  TopicService,
} from "@langwatch/topic-contract";
import {
  PostgresTopicAdapter,
  TOPIC_CLUSTERING_PROCESS_NAME,
  TopicClusteringLangevalsPort,
  TopicClusteringModelsPort,
  TopicClusteringSchedulePort,
  type TopicClusteringClickHouseResolver,
  type TopicClusteringCommandsPort,
  type TopicClusteringRunnerDeps,
  type TopicClusteringRepository,
  type TopicClusteringWritePathSeed,
} from "@langwatch/topic-server";
import type { prisma } from "~/server/db";
import { env } from "~/env.mjs";
import type { LegacyModelProviderExecution } from "~/server/api/routers/modelProviders.utils";
import {
  getProjectModelProviders,
  prepareLitellmParams,
} from "~/server/api/routers/modelProviders.utils";
import { getProjectEmbeddingsModel } from "~/server/embeddings";
import { stagedLangevalsFetch } from "~/server/langevals/stagedFetch";
import { getPayloadSizeHistogram } from "~/server/metrics";

type TopicDatabase = typeof prisma;

class AppTopicSchedulePort extends TopicClusteringSchedulePort {
  constructor(private readonly processStore: ProcessStore) {
    super();
  }

  async tryGetNextWakeAt(input: { projectId: string }): Promise<Date | null> {
    const instance = await this.processStore.findByRef({
      ref: {
        processName: TOPIC_CLUSTERING_PROCESS_NAME,
        projectId: input.projectId,
        processKey: input.projectId,
      },
    });
    if (!instance || instance.nextWakeAt === null) return null;
    return new Date(instance.nextWakeAt);
  }
}

/** Composes the process-owned Topic service and its eventing schedule read. */
export class AppTopicRuntime {
  private constructor(
    private readonly database: TopicDatabase,
    private readonly processStore: ProcessStore,
  ) {}

  static create(options: { database: TopicDatabase; processStore: ProcessStore }): AppTopicRuntime {
    return new AppTopicRuntime(options.database, options.processStore);
  }

  build(): TopicService {
    return PostgresTopicAdapter.create({
      database: this.database,
      schedule: new AppTopicSchedulePort(this.processStore),
    });
  }
}

/**
 * The clustering runner's model-resolution port over the app's model
 * provider cascade: `analytics.topic_clustering_llm` /
 * `analytics.topic_clustering_embeddings` feature keys, the legacy execution
 * provider record, and litellm params via the existing utils.
 */
export class AppTopicClusteringModelsPort extends TopicClusteringModelsPort<LegacyModelProviderExecution> {
  private constructor(
    private readonly modelProviders: ModelProviderService,
    private readonly managedProviders: ManagedProviderService,
  ) {
    super();
  }

  static create(options: {
    modelProviders: ModelProviderService;
    managedProviders: ManagedProviderService;
  }): AppTopicClusteringModelsPort {
    return new AppTopicClusteringModelsPort(options.modelProviders, options.managedProviders);
  }

  override resolveClusteringModel(projectId: string) {
    return this.modelProviders.resolveModelForFeature({
      projectId,
      featureKey: "analytics.topic_clustering_llm",
    });
  }

  override findExecutionProviders(projectId: string) {
    return getProjectModelProviders(this.modelProviders, projectId);
  }

  override resolveEmbeddingsModel(projectId: string) {
    return getProjectEmbeddingsModel(this.modelProviders, projectId);
  }

  override prepareLitellmParams(params: {
    model: string;
    modelProvider: LegacyModelProviderExecution;
    projectId: string;
  }) {
    return prepareLitellmParams(this.modelProviders, this.managedProviders, params);
  }
}

/** The clustering runner's langevals port over the app's staged S3 fetch. */
export class AppTopicClusteringLangevalsPort extends TopicClusteringLangevalsPort {
  override postClustering(params: {
    url: string;
    body: BatchClusteringParams | IncrementalClusteringParams;
    projectId: string;
    kind: "topic_clustering_batch" | "topic_clustering_incremental";
    signal?: AbortSignal;
  }) {
    return stagedLangevalsFetch(params);
  }
}

/**
 * Assembles the clustering runner's deps from App-level composition. Both
 * presets (worker dispatch) and the manual CLI task build the runner through
 * this, so the two paths cannot drift.
 */
export function createAppTopicClusteringRunnerDeps(options: {
  resolveClickHouseClient: TopicClusteringClickHouseResolver;
  modelProviders: ModelProviderService;
  managedProviders: ManagedProviderService;
  repository: TopicClusteringRepository;
  migration: TopicClusteringWritePathSeed;
  commands: TopicClusteringCommandsPort;
}): TopicClusteringRunnerDeps {
  return {
    resolveClickHouseClient: options.resolveClickHouseClient,
    models: AppTopicClusteringModelsPort.create({
      modelProviders: options.modelProviders,
      managedProviders: options.managedProviders,
    }),
    langevals: new AppTopicClusteringLangevalsPort(),
    langevalsEndpoint: env.LANGEVALS_ENDPOINT ?? null,
    repository: options.repository,
    migration: options.migration,
    commands: options.commands,
    observePayloadSize: (kind, sizeBytes) => getPayloadSizeHistogram(kind).observe(sizeBytes),
  };
}
