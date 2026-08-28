import type { ModelProviderService } from "@langwatch/model-provider-contract";
import { ModelProviderExecutionAdapter } from "@langwatch/model-provider-server";
import type { BatchClusteringParams, IncrementalClusteringParams } from "@langwatch/topic-contract";
import {
  TopicClusteringLangevalsPort,
  type TopicClusteringExecutionDependencies,
  type TopicClusteringClickHouseResolver,
  type TopicClusteringLangevalsKind,
  type TopicClusteringMetricsPort,
} from "@langwatch/topic-server";
import { stagedLangevalsFetch } from "~/server/langevals/stagedFetch";
import {
  getPayloadSizeHistogram,
  incrementTopicClusteringPageTotal,
  observeTopicClusteringPageDuration,
} from "~/server/metrics";

/** App-owned S3 staging transport for Topic's langevals requests. */
export class AppTopicClusteringLangevalsPort extends TopicClusteringLangevalsPort {
  postClustering(params: {
    url: string;
    body: BatchClusteringParams | IncrementalClusteringParams;
    projectId: string;
    kind: "topic_clustering_batch" | "topic_clustering_incremental";
    signal?: AbortSignal;
  }) {
    return stagedLangevalsFetch(params);
  }
}

/** App metrics adapter; Topic owns the metric names and outcome taxonomy. */
export class AppTopicClusteringMetricsAdapter implements TopicClusteringMetricsPort {
  incrementPageTotal: TopicClusteringMetricsPort["incrementPageTotal"] =
    incrementTopicClusteringPageTotal;
  observePageDuration: TopicClusteringMetricsPort["observePageDuration"] =
    observeTopicClusteringPageDuration;
}

/** Temporary legacy-app composition of Topic's technical execution ports. */
export function createAppTopicClusteringExecutionDependencies(options: {
  resolveClickHouseClient: TopicClusteringClickHouseResolver;
  modelProviders: ModelProviderService;
  langevalsEndpoint: string | null;
}): TopicClusteringExecutionDependencies {
  return {
    resolveClickHouseClient: options.resolveClickHouseClient,
    models: ModelProviderExecutionAdapter.create({
      modelProviders: options.modelProviders,
    }),
    langevals: new AppTopicClusteringLangevalsPort(),
    langevalsEndpoint: options.langevalsEndpoint,
    observePayloadSize(kind: TopicClusteringLangevalsKind, sizeBytes: number): void {
      getPayloadSizeHistogram(kind).observe(sizeBytes);
    },
  };
}
