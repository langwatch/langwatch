import type { OpsApi } from "@langwatch/ops-contract";
import {
  StaffFunctionBadInputError,
  type STAFF_ACCESS_TELEMETRY_FUNCTIONS,
  type StaffAccessFunctionInput,
  type StaffAccessFunctionOutput,
} from "@langwatch/staff-access-contract";
import { type Instant, Temporal } from "@langwatch/time";

import { pageOf, rangeOf } from "../rules/staff-access-function.rules.ts";
import { isoText } from "../rules/staff-access.rules.ts";
import type { StaffAccessFunctionRuns } from "./staff-access-function-reads.service.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
/** The query log is kept days, not weeks: `ch.query_errors` reads at most this many. */
const CH_QUERY_ERRORS_MAX_RANGE_DAYS = 7;

type TelemetryReadsDeps = Readonly<{
  ops: Pick<OpsApi, "findClickHouseQueryErrors" | "getClickHouseHealth">;
}>;

/** The telemetry ops functions' reads, each through the owning module's `*Api` (§3). */
export class StaffAccessTelemetryFunctionReadsService {
  readonly reads: StaffAccessFunctionRuns<keyof typeof STAFF_ACCESS_TELEMETRY_FUNCTIONS>;

  private constructor(private readonly deps: TelemetryReadsDeps) {
    this.reads = {
      "ch.query_errors": (call) => this.queryErrors(call),
      "ch.health": (call) => this.health(call),
    };
  }

  static create(deps: TelemetryReadsDeps): StaffAccessTelemetryFunctionReadsService {
    return new StaffAccessTelemetryFunctionReadsService(deps);
  }

  /** @throws {StaffFunctionBadInputError} for a range past the query log's seven days */
  private async queryErrors({
    input,
    at,
  }: {
    input: StaffAccessFunctionInput<"ch.query_errors">;
    at: Instant;
  }): Promise<StaffAccessFunctionOutput<"ch.query_errors">> {
    const range = rangeOf({
      since: input.since,
      ...(input.until ? { until: input.until } : {}),
      at,
    });
    const sinceMs = range.since.epochMilliseconds;
    const untilMs = range.until.epochMilliseconds;
    if (untilMs - sinceMs > CH_QUERY_ERRORS_MAX_RANGE_DAYS * DAY_MS) {
      throw new StaffFunctionBadInputError({
        issues: [`the range spans at most ${CH_QUERY_ERRORS_MAX_RANGE_DAYS} days`],
      });
    }
    const groups = await this.deps.ops.findClickHouseQueryErrors({
      sinceMs,
      untilMs,
      ...(input.code === undefined ? {} : { code: input.code }),
      ...(input.source === undefined ? {} : { source: input.source }),
    });
    const rows = groups.map((group) => ({
      queryShapeId: group.queryShapeId,
      source: group.source,
      code: group.code,
      codeName: group.codeName,
      count: group.count,
      p95Ms: group.p95Ms,
      maxMemoryBytes: group.maxMemoryBytes,
      rowsRead: group.rowsRead,
      projectIds: [...group.projectIds],
      lastAt: isoText(Temporal.Instant.fromEpochMilliseconds(group.lastAt)),
    }));
    return pageOf({
      rows,
      keyOf: (row) => `${row.source}/${row.code}/${row.queryShapeId}`,
      name: "ch.query_errors",
      ...pageInputOf(input),
    });
  }

  private async health({
    input,
  }: {
    input: StaffAccessFunctionInput<"ch.health">;
  }): Promise<StaffAccessFunctionOutput<"ch.health">> {
    const health = await this.deps.ops.getClickHouseHealth();
    return {
      nodes: health.nodes,
      replicas: { ...health.replicas },
      merges: { ...health.merges },
      disks: { ...health.disks },
      memory: { ...health.memory },
      tables: pageOf({
        rows: health.tables.map((table) => ({ ...table })),
        keyOf: (row) => row.table,
        name: "ch.health",
        ...pageInputOf(input),
      }),
    };
  }
}

function pageInputOf(input: { limit?: number; cursor?: string }): {
  limit?: number;
  cursor?: string;
} {
  return {
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
  };
}
