/**
 * Instant-eval's `instant_eval_runs`, shared with trace for reading: each run
 * collapsed to its latest version, as instant-eval's own lookup collapses it.
 */
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { clickhouseRead, fn, param, tenantScope } from "@langwatch/clickhouse-client/builder";
import { Temporal } from "@langwatch/time";
import { z } from "zod";

import {
  type TraceInstantEvalRunRow,
  TraceInstantEvalRunsReadRepository,
} from "../trace-instant-eval-runs.repository.ts";
import { instantEvalRuns } from "./clickhouse.instant-eval-runs.table.ts";
import { chNumber, chString } from "./stored-span-row.mapper.ts";

const runRowsSchema = z.array(
  z.looseObject({ RunId: chString, CreatedAtMs: chNumber, FinishedAtMs: chNumber.nullable() }),
);

/** Each named run's latest version, elected on instant-eval's own tuple version. */
function runsByIdsStatement({
  projectId,
  runIds,
}: {
  projectId: string;
  runIds: readonly string[];
}) {
  return clickhouseRead({ scope: tenantScope.single({ tenantId: projectId }) })
    .from(instantEvalRuns)
    .select({
      RunId: instantEvalRuns.RunId,
      CreatedAtMs: fn.toUnixTimestamp64Milli(instantEvalRuns.CreatedAt),
      FinishedAtMs: fn.toUnixTimestamp64Milli(instantEvalRuns.FinishedAt),
    })
    .where(({ oneOf }) => oneOf(instantEvalRuns.RunId, [...new Set(runIds)]))
    .latestVersion({
      version: fn.tuple(
        instantEvalRuns.WrittenAt,
        fn.ifNull(instantEvalRuns.AcceptedAt, fn.toDateTime64(param.uint32(0), 3)),
        instantEvalRuns.LastEventId,
      ),
    })
    .limitBy(1, instantEvalRuns.RunId)
    .build();
}

export class ClickHouseTraceInstantEvalRunsRepository extends TraceInstantEvalRunsReadRepository {
  static create(options: {
    reader: Pick<ClickHouseQueryClient, "read">;
  }): ClickHouseTraceInstantEvalRunsRepository {
    return new ClickHouseTraceInstantEvalRunsRepository(options.reader);
  }

  private constructor(private readonly reader: Pick<ClickHouseQueryClient, "read">) {
    super();
  }

  async findRunsByIds({
    projectId,
    runIds,
  }: {
    projectId: string;
    runIds: readonly string[];
  }): Promise<TraceInstantEvalRunRow[]> {
    if (runIds.length === 0) return [];
    const result = await this.reader.read({
      // ID_BOUND_SKIP: a lookup by run id on instant-eval's own sort key.
      statement: runsByIdsStatement({ projectId, runIds }),
      table: instantEvalRuns.$table.name,
    });
    return runRowsSchema.parse(result.rows).map((row) => ({
      runId: row.RunId,
      createdAt: Temporal.Instant.fromEpochMilliseconds(row.CreatedAtMs),
      finishedAt:
        row.FinishedAtMs === null ? null : Temporal.Instant.fromEpochMilliseconds(row.FinishedAtMs),
    }));
  }
}
