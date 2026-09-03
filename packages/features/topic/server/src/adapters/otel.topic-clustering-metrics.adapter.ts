import { counter, histogram, type CounterHandle, type HistogramHandle } from "@langwatch/observability/metrics";
import type { TopicClusteringMetricsPort } from "../intents/topic-clustering.intent";

/**
 * The two series names, pinned because two processes write them.
 *
 * The App writes them through its own `prom-client` registry; a worker
 * composed from packages writes them over OTLP. Same counter, same histogram,
 * same `outcome` and `mode` labels — an operator asking "how many clustering
 * pages failed" must not have to know which process ran them.
 */
export const TOPIC_CLUSTERING_PAGE_TOTAL_METRIC_NAME = "topic_clustering_page_total";
export const TOPIC_CLUSTERING_PAGE_DURATION_METRIC_NAME =
  "topic_clustering_page_duration_milliseconds";

/** Topic clustering page outcomes and durations, pushed over OTLP. */
export class OtelTopicClusteringMetricsAdapter implements TopicClusteringMetricsPort {
  static create(): OtelTopicClusteringMetricsAdapter {
    return new OtelTopicClusteringMetricsAdapter(
      counter({
        name: TOPIC_CLUSTERING_PAGE_TOTAL_METRIC_NAME,
        description: "Topic clustering page executions by outcome",
      }),
      histogram({
        name: TOPIC_CLUSTERING_PAGE_DURATION_METRIC_NAME,
        description: "Duration of one topic clustering page (langevals call included)",
      }),
    );
  }

  private constructor(
    private readonly pages: CounterHandle,
    private readonly duration: HistogramHandle,
  ) {}

  incrementPageTotal(params: Parameters<TopicClusteringMetricsPort["incrementPageTotal"]>[0]): void {
    this.pages.inc({ outcome: params.outcome }, 1);
  }

  observePageDuration(
    params: Parameters<TopicClusteringMetricsPort["observePageDuration"]>[0],
  ): void {
    this.duration.observe(params.durationMs, { mode: params.mode });
  }
}
