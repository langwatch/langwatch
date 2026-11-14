import type { Authorization } from "@langwatch/authorization";
import {
  type ClickHouseQueryClient,
  type IdBoundOptions,
  ownProjectIdOf,
} from "@langwatch/clickhouse-client";
import {
  clickhouseRead,
  type Expression,
  fn,
  tenantScope,
} from "@langwatch/clickhouse-client/builder";
import { EventUtils } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { DerivedTraceEvent, NormalizedSpan } from "@langwatch/trace-contract";
import { z } from "zod";

import { storedSpans as spans } from "./clickhouse.stored-spans.table.ts";
import {
  chNumber,
  chString,
  chStringMap,
  fullSpanRowsSchema,
  mapChRowToNormalized,
} from "./stored-span-row.mapper.ts";

const logger = createLogger("langwatch:trace:derivation-span-repository");

/** One flattened `Events.*` tuple, as ClickHouse hands it back. */
const traceEventRowSchema = z.looseObject({
  spanId: chString,
  timestamp: chNumber,
  name: chString,
  attributes: chStringMap.nullish(),
});

const traceEventRowsSchema = z.array(traceEventRowSchema);

// Derivation span limit caps memory per-role sum (matches projection path cap)
const DERIVATION_SPAN_LIMIT = 10_000;

// Event limit caps the product (spans × events per span); matches app's own ceiling
const DERIVATION_EVENT_LIMIT = 10_000;

/**
 * Per-query ceiling for the whole-trace fetch. `max_memory_usage` keeps one
 * runaway trace failing on its own read rather than the pod; dedup is done
 * in SQL so a re-exported span cannot be counted twice into a role total.
 */
const DERIVATION_FETCH_SETTINGS = {
  max_memory_usage: 2_000_000_000,
  max_execution_time: 30,
} as const;

/**
 * A caller's time is read first; otherwise the id index bounds the read once ready, and before
 * that, or for a trace it has never seen, the read is unbounded as before the index.
 */
function idBoundOf({ occurredAtMs }: { occurredAtMs?: number | undefined }): IdBoundOptions {
  return { occurredAtHint: occurredAtMs ?? null, fallback: "unbounded", onMiss: "unbounded" };
}

// Every stored span of one trace for scenario role derivation; uses argMax with
// UpdatedAt (not LIMIT 1 BY which materializes columns for whole granules)
export class TraceDerivationSpanClickHouseRepository {
  static create(options: {
    clickhouse: Pick<ClickHouseQueryClient, "read">;
  }): TraceDerivationSpanClickHouseRepository {
    return new TraceDerivationSpanClickHouseRepository(options.clickhouse);
  }

  private constructor(private readonly clickhouse: Pick<ClickHouseQueryClient, "read">) {}

  async findNormalizedSpansByTraceId(input: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
    limit?: number;
  }): Promise<NormalizedSpan[]> {
    EventUtils.validateTenantId(
      { tenantId: input.tenantId },
      "TraceDerivationSpanClickHouseRepository.findNormalizedSpansByTraceId",
    );

    try {
      return await this.fetchTraceSpanRows(input);
    } catch (error) {
      logger.warn(
        {
          tenantId: input.tenantId,
          traceId: input.traceId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to read a trace's stored spans from ClickHouse",
      );
      throw error;
    }
  }

  // Every span event of one trace, flattened. ARRAY JOIN outside dedup subquery
  // to avoid multiplying tuple comparisons by event count
  async findDerivedEventsByTraceId({
    authorization,
    ...rest
  }: {
    authorization: Authorization;
    traceId: string;
    occurredAtMs?: number;
  }): Promise<DerivedTraceEvent[]> {
    // shortcut: this read still filters one TenantId, so it takes the proof's own project;
    // fence it through AuthorizedClickHouse once an aggregate derives events.
    const input = { ...rest, tenantId: ownProjectIdOf({ authorization, reads: "traces" }) };
    EventUtils.validateTenantId(
      { tenantId: input.tenantId },
      "TraceDerivationSpanClickHouseRepository.findDerivedEventsByTraceId",
    );

    try {
      return await this.fetchTraceEventRows(input);
    } catch (error) {
      logger.warn(
        {
          tenantId: input.tenantId,
          traceId: input.traceId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to read a trace's span events from ClickHouse",
      );
      throw error;
    }
  }

  private async fetchTraceEventRows(input: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number | undefined;
  }): Promise<DerivedTraceEvent[]> {
    const scope = tenantScope.single({ tenantId: input.tenantId });
    const latest = clickhouseRead({ scope })
      .from(spans)
      .select({
        SpanId: spans.SpanId,
        LatestEvents: fn.arrayZip(
          fn.argMax(spans["Events.Timestamp"], spans.UpdatedAt),
          fn.argMax(spans["Events.Name"], spans.UpdatedAt),
          fn.argMax(spans["Events.Attributes"], spans.UpdatedAt),
        ),
      })
      .where(({ idBound }) => idBound(spans.TraceId, input.traceId))
      .groupBy(spans.SpanId)
      .as("latest");
    const events = clickhouseRead({ scope })
      .from(latest)
      .select({ SpanId: latest.SpanId, Event: fn.arrayJoin(latest.LatestEvents) })
      .as("events");
    const statement = clickhouseRead({ scope })
      .from(events)
      .select({
        spanId: events.SpanId,
        timestamp: fn.toUnixTimestamp64Milli(fn.tupleElement(events.Event, "0")),
        name: fn.tupleElement(events.Event, "1"),
        attributes: fn.tupleElement(events.Event, "2"),
      })
      .orderBy("timestamp", "ASC")
      .limit(DERIVATION_EVENT_LIMIT)
      .settings(DERIVATION_FETCH_SETTINGS)
      .build();
    const result = await this.clickhouse.read({
      statement,
      table: spans.$table.name,
      idBound: idBoundOf(input),
    });

    return traceEventRowsSchema.parse(result.rows).map((row) => ({
      spanId: row.spanId,
      timestamp: row.timestamp,
      name: row.name,
      attributes: row.attributes ?? {},
    }));
  }

  private async fetchTraceSpanRows(input: {
    tenantId: string;
    traceId: string;
    limit?: number;
    occurredAtMs?: number | undefined;
  }): Promise<NormalizedSpan[]> {
    const scope = tenantScope.single({ tenantId: input.tenantId });
    const latestOf = <V, T extends string>(of: Expression<V, T>) => fn.argMax(of, spans.UpdatedAt);
    // Inner keys may not reuse a declared column's name; the outer read names them back.
    const latest = clickhouseRead({ scope })
      .from(spans)
      .select({
        SpanId: spans.SpanId,
        LatestTraceId: latestOf(spans.TraceId),
        LatestTenantId: latestOf(spans.TenantId),
        LatestParentSpanId: latestOf(spans.ParentSpanId),
        LatestParentTraceId: latestOf(spans.ParentTraceId),
        LatestParentIsRemote: latestOf(spans.ParentIsRemote),
        LatestSampled: latestOf(spans.Sampled),
        LatestStartTime: latestOf(spans.StartTime),
        LatestEndTime: latestOf(spans.EndTime),
        LatestDurationMs: latestOf(spans.DurationMs),
        LatestSpanName: latestOf(spans.SpanName),
        LatestSpanKind: latestOf(spans.SpanKind),
        LatestResourceAttributes: latestOf(spans.ResourceAttributes),
        LatestSpanAttributes: latestOf(spans.SpanAttributes),
        LatestStatusCode: latestOf(spans.StatusCode),
        LatestStatusMessage: latestOf(spans.StatusMessage),
        LatestScopeName: latestOf(spans.ScopeName),
        LatestScopeVersion: latestOf(spans.ScopeVersion),
        LatestCost: latestOf(spans.Cost),
        LatestNonBilledCost: latestOf(spans.NonBilledCost),
      })
      .where(({ idBound }) => idBound(spans.TraceId, input.traceId))
      .groupBy(spans.SpanId)
      .as("latest");
    // Narrow columns only: Events.* and Links.* stay out (mapChRowToNormalized defaults them).
    const statement = clickhouseRead({ scope })
      .from(latest)
      .select({
        SpanId: latest.SpanId,
        TraceId: latest.LatestTraceId,
        TenantId: latest.LatestTenantId,
        ParentSpanId: latest.LatestParentSpanId,
        ParentTraceId: latest.LatestParentTraceId,
        ParentIsRemote: latest.LatestParentIsRemote,
        Sampled: latest.LatestSampled,
        StartTimeMs: fn.toUnixTimestamp64Milli(latest.LatestStartTime),
        EndTimeMs: fn.toUnixTimestamp64Milli(latest.LatestEndTime),
        DurationMs: latest.LatestDurationMs,
        SpanName: latest.LatestSpanName,
        SpanKind: latest.LatestSpanKind,
        ResourceAttributes: latest.LatestResourceAttributes,
        SpanAttributes: latest.LatestSpanAttributes,
        StatusCode: latest.LatestStatusCode,
        StatusMessage: latest.LatestStatusMessage,
        ScopeName: latest.LatestScopeName,
        ScopeVersion: latest.LatestScopeVersion,
        Cost: latest.LatestCost,
        NonBilledCost: latest.LatestNonBilledCost,
      })
      .orderBy("StartTimeMs", "ASC")
      .limit(input.limit ?? DERIVATION_SPAN_LIMIT)
      .settings(DERIVATION_FETCH_SETTINGS)
      .build();
    const result = await this.clickhouse.read({
      statement,
      table: spans.$table.name,
      idBound: idBoundOf(input),
    });

    return fullSpanRowsSchema.parse(result.rows).map((row) => mapChRowToNormalized(row));
  }
}
