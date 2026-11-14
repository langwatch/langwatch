import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { type Instant, Temporal } from "@langwatch/time";
import { z } from "zod";

import { AnalyticsRecencyRepository } from "../analytics-recency.repository.ts";
import {
  type RecencyInput,
  lastOccurredAtRead,
} from "./clickhouse.analytics-latest-reads.mapper.ts";
import { evaluationAnalytics } from "./clickhouse.evaluation-analytics.table.ts";
import { traceAnalytics } from "./clickhouse.trace-analytics.table.ts";

const lastMsSchema = z.union([z.string(), z.number(), z.null()]).optional();

export class ClickHouseAnalyticsRecencyRepository extends AnalyticsRecencyRepository {
  private constructor(private readonly clickhouse: Pick<ClickHouseQueryClient, "read">) {
    super();
  }

  static create(
    clickhouse: Pick<ClickHouseQueryClient, "read">,
  ): ClickHouseAnalyticsRecencyRepository {
    return new ClickHouseAnalyticsRecencyRepository(clickhouse);
  }

  async findLastOccurredAt(input: RecencyInput): Promise<Instant[]> {
    const statement = lastOccurredAtRead(input);
    const table = input.source === "evaluation" ? evaluationAnalytics : traceAnalytics;
    const { rows } = await this.clickhouse.read({ statement, table: table.$table.name });

    const lastMs = lastMsSchema.parse(rows[0]?.lastMs);
    if (lastMs === null || lastMs === undefined) return [];
    const ms = typeof lastMs === "string" ? Number.parseInt(lastMs, 10) : lastMs;
    if (!Number.isFinite(ms) || ms <= 0) return [];
    return [Temporal.Instant.fromEpochMilliseconds(ms)];
  }
}
