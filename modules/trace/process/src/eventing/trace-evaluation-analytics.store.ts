import {
  type FoldReadAuthorizer,
  foldReadPurpose,
  type ProjectionStoreContext,
} from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import type { TraceEvaluationAnalyticsRepository } from "../repositories/trace-evaluation-analytics.repository.ts";
import {
  LIVE_ROW_LOOKBACK_MS,
  type TraceEvaluationAnalyticsRow,
  traceEvaluationRowsDigest,
  traceEvaluationRowsOf,
  traceEvaluationRowWrites,
  type TraceRowColumns,
} from "../rules/trace-evaluation-analytics.rules.ts";
import type { TraceAnalyticsData } from "./trace-derived.projection.ts";

/** One fold write: the state, its store context, and the trace_analytics row it becomes. */
export interface TraceEvaluationAnalyticsEntry {
  state: TraceAnalyticsData;
  context: ProjectionStoreContext;
  traceRow: TraceRowColumns;
}

/**
 * Writes trace_evaluation_analytics before the fold's trace_analytics row, diffing against
 * ClickHouse's live rows, never fold state: the writes are not atomic, so a crash between them, a
 * replay (digest '') or an older row's read-back heals instead of duplicating (trace ADR-003).
 */
export class TraceEvaluationAnalyticsStore {
  private constructor(
    private readonly options: {
      storage: TraceEvaluationAnalyticsRepository;
      defaultRetentionDays: () => number;
      authorize: FoldReadAuthorizer;
      now: () => number;
    },
  ) {}

  static create(options: {
    storage: TraceEvaluationAnalyticsRepository;
    defaultRetentionDays: () => number;
    authorize: FoldReadAuthorizer;
    /** Processing time for `UpdatedAt`, injected for test determinism. */
    now?: () => number;
  }): TraceEvaluationAnalyticsStore {
    return new TraceEvaluationAnalyticsStore({
      ...options,
      now: options.now ?? (() => nowInstant().epochMilliseconds),
    });
  }

  /** Brings each entry's evaluation rows up to date; answers each entry's rows digest, in order. */
  async writeBatch(entries: readonly TraceEvaluationAnalyticsEntry[]): Promise<string[]> {
    const planned = entries.map((entry) => {
      const rows = traceEvaluationRowsOf({ state: entry.state, traceRow: entry.traceRow });
      return { entry, rows, digest: traceEvaluationRowsDigest(rows) };
    });
    const pending = planned.filter(
      ({ rows, digest, entry }) =>
        rows.length > 0 && digest !== (entry.state.evaluationRowsDigest ?? ""),
    );
    for (const group of TraceEvaluationAnalyticsStore.byTenant(pending)) {
      await this.writeTenant(group);
    }
    return planned.map(({ digest }) => digest);
  }

  /** One live-row read for the tenant's traces, then one insert of every change. */
  private async writeTenant(
    group: readonly {
      entry: TraceEvaluationAnalyticsEntry;
      rows: TraceEvaluationAnalyticsRow[];
    }[],
  ): Promise<void> {
    const [first] = group;
    if (!first) return;
    const tenantId = String(first.entry.context.tenantId);
    const live = await this.options.storage.findLiveRows({
      authorization: await this.options.authorize({
        projectId: tenantId,
        purpose: foldReadPurpose({
          context: first.entry.context,
          entry: "TraceEvaluationAnalyticsStore.writeBatch",
        }),
      }),
      traceIds: [...new Set(group.map(({ entry }) => entry.traceRow.traceId))],
      occurredAtFromMs:
        Math.min(...group.map(({ entry }) => entry.traceRow.occurredAtMs)) - LIVE_ROW_LOOKBACK_MS,
    });
    const updatedAtMs = this.options.now();
    const writes = group.flatMap(({ entry, rows }) =>
      traceEvaluationRowWrites({
        wanted: rows,
        live: live.filter((candidate) => candidate.row.traceId === entry.traceRow.traceId),
        updatedAtMs,
        retentionDays: entry.context.retentionPolicy?.traces ?? this.options.defaultRetentionDays(),
      }),
    );
    if (writes.length === 0) return;
    await this.options.storage.insertRows({ writes });
  }

  private static byTenant<T extends { entry: TraceEvaluationAnalyticsEntry }>(
    planned: readonly T[],
  ): T[][] {
    const groups = new Map<string, T[]>();
    for (const item of planned) {
      const tenantId = String(item.entry.context.tenantId);
      groups.set(tenantId, [...(groups.get(tenantId) ?? []), item]);
    }
    return [...groups.values()];
  }
}
