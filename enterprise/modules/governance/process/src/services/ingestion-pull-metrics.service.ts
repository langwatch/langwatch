// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  counter,
  histogram,
  type CounterHandle,
  type HistogramHandle,
} from "@langwatch/observability/metrics";

import type { IngestionPullMetricsSink } from "../app/governance.members.ts";

export const INGESTION_PULL_TOTAL_METRIC_NAME = "ingestion_pull_total";
export const INGESTION_PULL_DURATION_METRIC_NAME = "ingestion_pull_duration_milliseconds";

/** Ingestion-pull runs by outcome, and how long each took, pushed over OTLP. */
export class IngestionPullMetricsService implements IngestionPullMetricsSink {
  private constructor(
    private readonly runs: CounterHandle,
    private readonly duration: HistogramHandle,
  ) {}

  static create(): IngestionPullMetricsService {
    return new IngestionPullMetricsService(
      counter({
        name: INGESTION_PULL_TOTAL_METRIC_NAME,
        description: "Ingestion pull runs by outcome",
      }),
      histogram({
        name: INGESTION_PULL_DURATION_METRIC_NAME,
        description: "Duration of one ingestion pull run",
      }),
    );
  }

  count(outcome: "completed" | "failed_retryable" | "failed_final"): void {
    this.runs.inc({ outcome }, 1);
  }

  observeDuration(durationMs: number): void {
    this.duration.observe(durationMs);
  }
}
