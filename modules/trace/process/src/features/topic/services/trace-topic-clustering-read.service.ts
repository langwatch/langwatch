import { nowInstant } from "@langwatch/time";
import type {
  TraceTopicClusteringCounts,
  TraceTopicClusteringPage,
  TraceTopicClusteringPageInput,
  TraceTopicClusteringTrace,
} from "@langwatch/trace-contract";

import type {
  TraceClusteringSampleRepository,
  TraceClusteringSampleRow,
} from "../repositories/trace-clustering-sample.repository.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_WINDOW_DAYS = 30;
/** The mode window reads light columns only, so it spans the project's whole year. */
const CLUSTERING_MODE_WINDOW_DAYS = 365;
/** The fetch window reads the heavy input column, so it stays on the hot tier. */
const CLUSTERING_FETCH_WINDOW_DAYS = 49;
const MAX_INPUT_CHARACTERS = 8192;

/** The traces topic clustering counts and pages, read from trace's own summaries. */
export class TraceTopicClusteringReadService {
  static create(options: {
    repository: TraceClusteringSampleRepository;
    now?: () => number;
  }): TraceTopicClusteringReadService {
    return new TraceTopicClusteringReadService(
      options.repository,
      options.now ?? (() => nowInstant().epochMilliseconds),
    );
  }

  private constructor(
    private readonly repository: TraceClusteringSampleRepository,
    private readonly now: () => number,
  ) {}

  async readCounts(input: { projectId: string }): Promise<TraceTopicClusteringCounts> {
    const now = this.now();
    const counts = await this.repository.countTraces({
      tenantId: input.projectId,
      recentSinceMs: now - RECENT_WINDOW_DAYS * DAY_MS,
      windowStartMs: now - CLUSTERING_MODE_WINDOW_DAYS * DAY_MS,
    });

    return {
      totalTracesCount: counts.total,
      recentTracesCount: counts.recent,
      assignedTracesCount: counts.assigned,
    };
  }

  async readPage(input: TraceTopicClusteringPageInput): Promise<TraceTopicClusteringPage> {
    const { topicIds, subtopicIds } = input;
    const rawRows = await this.repository.findPageRows({
      tenantId: input.projectId,
      windowStartMs: this.now() - CLUSTERING_FETCH_WINDOW_DAYS * DAY_MS,
      ...(input.isIncrementalProcessing && (topicIds.length > 0 || subtopicIds.length > 0)
        ? { unassignedFrom: { topicIds, subtopicIds } }
        : {}),
      ...(input.searchAfter ? { searchAfter: input.searchAfter } : {}),
    });

    // The query drops its ORDER BY to avoid buffering, so the page order is restored here.
    const rows = TraceTopicClusteringReadService.firstPerTrace(
      rawRows.toSorted((a, b) => TraceTopicClusteringReadService.pageOrder(a, b)),
    );
    const traces = rows
      .map((row): TraceTopicClusteringTrace | null => {
        const inputText = TraceTopicClusteringReadService.extractInput(row.computedInput);
        if (!inputText || inputText === "<empty>") return null;

        return {
          trace_id: row.traceId,
          input: inputText.slice(0, MAX_INPUT_CHARACTERS),
          topic_id: row.topicId && topicIds.includes(row.topicId) ? row.topicId : null,
          subtopic_id:
            row.subtopicId && subtopicIds.includes(row.subtopicId) ? row.subtopicId : null,
        };
      })
      .filter((trace): trace is TraceTopicClusteringTrace => trace !== null);
    const lastRow = rows[rows.length - 1];

    return {
      traces,
      lastSort: lastRow ? [lastRow.occurredAtMs, lastRow.traceId] : undefined,
      returnedCount: rows.length,
    };
  }

  /** OccurredAt descending, then TraceId ascending: the cursor's order. */
  private static pageOrder(a: TraceClusteringSampleRow, b: TraceClusteringSampleRow): number {
    if (a.occurredAtMs !== b.occurredAtMs) return b.occurredAtMs - a.occurredAtMs;
    if (a.traceId < b.traceId) return -1;
    if (a.traceId > b.traceId) return 1;
    return 0;
  }

  /** De-duplicated here, not in SQL: the per-key SQL dedup reads heavy columns whole-granule. */
  private static firstPerTrace(rows: TraceClusteringSampleRow[]): TraceClusteringSampleRow[] {
    const seen = new Set<string>();
    return rows.filter((row) => {
      if (seen.has(row.traceId)) return false;
      seen.add(row.traceId);
      return true;
    });
  }

  private static extractInput(computedInput: string | null): string {
    if (!computedInput) return "<empty>";

    try {
      const parsed = JSON.parse(computedInput);
      if (typeof parsed === "string") return parsed || "<empty>";
      if (typeof parsed?.value === "string") {
        return TraceTopicClusteringReadService.unwrapInnerInput(parsed.value) || "<empty>";
      }
      if (typeof parsed?.input === "string") return parsed.input || "<empty>";
      return typeof parsed === "object" ? JSON.stringify(parsed) : String(parsed) || "<empty>";
    } catch {
      return computedInput || "<empty>";
    }
  }

  private static unwrapInnerInput(value: string): string {
    try {
      const inner = JSON.parse(value);
      if (typeof inner?.input === "string" && inner.input.length > 0) return inner.input;
    } catch {
      return value;
    }
    return value;
  }
}
