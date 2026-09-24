import {
  counter,
  histogram,
  type CounterHandle,
  type HistogramHandle,
} from "@langwatch/observability/metrics";

import type { TopicClusteringMetrics } from "../eventing/topic-clustering.intent.ts";

/**
 * The two series names, pinned because two processes write them: the App
 * via `prom-client`, a worker via OTLP — same counter, histogram, and
 * `outcome`/`mode` labels, so a query need not know which process ran it.
 */
export const TOPIC_CLUSTERING_PAGE_TOTAL_METRIC_NAME = "topic_clustering_page_total";
export const TOPIC_CLUSTERING_PAGE_DURATION_METRIC_NAME =
  "topic_clustering_page_duration_milliseconds";
/** The series the App writes for the same langevals request-size measurement. */
export const TOPIC_CLUSTERING_PAYLOAD_SIZE_METRIC_NAME = "payload_size_bytes";

/** Topic clustering page outcomes and durations, pushed over OTLP. */
export class OtelTopicClusteringMetricsService implements TopicClusteringMetrics {
  static create(): OtelTopicClusteringMetricsService {
    return new OtelTopicClusteringMetricsService(
      counter({
        name: TOPIC_CLUSTERING_PAGE_TOTAL_METRIC_NAME,
        description: "Topic clustering page executions by outcome",
      }),
      histogram({
        name: TOPIC_CLUSTERING_PAGE_DURATION_METRIC_NAME,
        description: "Duration of one topic clustering page (langevals call included)",
      }),
      histogram({
        name: TOPIC_CLUSTERING_PAYLOAD_SIZE_METRIC_NAME,
        description: "Size of a request payload in bytes",
      }),
    );
  }

  private constructor(
    private readonly pages: CounterHandle,
    private readonly duration: HistogramHandle,
    private readonly payloadSize: HistogramHandle,
  ) {}

  incrementPageTotal(params: Parameters<TopicClusteringMetrics["incrementPageTotal"]>[0]): void {
    this.pages.inc({ outcome: params.outcome }, 1);
  }

  observePageDuration(params: Parameters<TopicClusteringMetrics["observePageDuration"]>[0]): void {
    this.duration.observe(params.durationMs, { mode: params.mode });
  }

  observePayloadSize(kind: string, sizeBytes: number): void {
    this.payloadSize.observe(sizeBytes, { endpoint: kind });
  }
}
