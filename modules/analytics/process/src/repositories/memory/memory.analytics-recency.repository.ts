import type { AnalyticsMetricSource } from "@langwatch/analytics-contract";
import { type Instant, Temporal } from "@langwatch/time";

import { AnalyticsRecencyRepository } from "../analytics-recency.repository.ts";
import type { MemoryEvaluationAnalyticsTable } from "./memory.analytics-persistence.repository.ts";

/**
 * Reads the newest evaluation versions its evaluation twin keeps, as the deduped live read does.
 * Trace rows are another module's writes, so this tier holds none.
 */
export class MemoryAnalyticsRecencyRepository extends AnalyticsRecencyRepository {
  static create({
    evaluations,
  }: Readonly<{ evaluations: MemoryEvaluationAnalyticsTable }>): MemoryAnalyticsRecencyRepository {
    return new MemoryAnalyticsRecencyRepository(evaluations);
  }

  readonly #evaluations: MemoryEvaluationAnalyticsTable;

  private constructor(evaluations: MemoryEvaluationAnalyticsTable) {
    super();
    this.#evaluations = evaluations;
  }

  findLastOccurredAt(input: {
    projectId: string;
    source: AnalyticsMetricSource;
    since: Instant;
  }): Promise<Instant[]> {
    if (input.source !== "evaluation") return Promise.resolve([]);

    const sinceMs = input.since.epochMilliseconds;
    const versions = [...(this.#evaluations.get(input.projectId)?.values() ?? [])].flat();
    const lastMs = Math.max(
      ...versions
        .map(({ row }) => row.occurredAtMs)
        .filter((occurredAtMs) => occurredAtMs >= sinceMs),
    );
    return Promise.resolve(lastMs > 0 ? [Temporal.Instant.fromEpochMilliseconds(lastMs)] : []);
  }
}
