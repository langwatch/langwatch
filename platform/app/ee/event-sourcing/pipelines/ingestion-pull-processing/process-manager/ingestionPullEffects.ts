import { IngestionPullMetricsPort } from "@langwatch/enterprise-governance-server";
import {
  incrementIngestionPullTotal,
  observeIngestionPullDuration,
} from "~/server/metrics";

export class AppIngestionPullMetricsPort extends IngestionPullMetricsPort {
  static create(): AppIngestionPullMetricsPort {
    return new AppIngestionPullMetricsPort();
  }

  count(
    outcome: "completed" | "failed_retryable" | "failed_final",
  ): void {
    incrementIngestionPullTotal({ outcome });
  }

  observeDuration(durationMs: number): void {
    observeIngestionPullDuration({ durationMs });
  }
}
