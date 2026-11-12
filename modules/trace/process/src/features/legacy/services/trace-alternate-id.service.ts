/**
 * Finds the trace an id names when it is not the exact trace id: a prefix, a scenario run or a span.
 * @see modules/trace/specs/trace-lookup-by-id.feature
 */
import type { Authorization } from "@langwatch/authorization";
import { nowInstant } from "@langwatch/time";
import { ScenarioRunHasManyTracesError } from "@langwatch/trace-contract";

import type { TraceLegacyReadRepository } from "../repositories/trace-legacy-read.repository.ts";
import {
  isHexId,
  isScenarioRunId,
  looksLikeSpanId,
  type TraceLookupResolvedFrom,
} from "../rules/trace-id-lookup.rules.ts";
import type { LegacyTraceMappingService } from "./legacy-trace-mapping.service.ts";

/**
 * Minimum prefix length we will attempt to resolve. Shorter strings fall through to "not found" —
 * this avoids scanning the entire trace_summaries table on a single-character typo.
 */
const MIN_TRACE_ID_PREFIX_LENGTH = 8;

/**
 * Full length of a trace ID. Inputs shorter than this are treated as
 * potential prefixes; equal-or-longer inputs are treated as literal IDs.
 */
const FULL_TRACE_ID_LENGTH = 32;

/**
 * How many candidates the resolver asks ClickHouse for when disambiguating
 * a prefix. Matches the cap the error message previews, so API clients see
 * every candidate the resolver considered.
 */
const TRACE_ID_PREFIX_CANDIDATE_LIMIT = 5;

/**
 * Time window (in days) that prefix resolution scans. Without a partition bound, ClickHouse
 * would scan every partition (incl. cold S3 storage) on a miss. Full 32-char IDs still resolve
 * unbounded via the normal exact-match path.
 */
const TRACE_ID_PREFIX_LOOKUP_WINDOW_DAYS = 90;

/**
 * Thrown when a trace ID prefix matches more than one trace in the project.
 * Callers (route handlers) map this to a 409 response listing the full
 * candidate IDs so the user can disambiguate.
 */
export class AmbiguousTraceIdPrefixError extends Error {
  constructor(
    public readonly prefix: string,
    public readonly candidateTraceIds: string[],
  ) {
    const preview = candidateTraceIds.slice(0, TRACE_ID_PREFIX_CANDIDATE_LIMIT).join(", ");
    const suffix =
      candidateTraceIds.length > TRACE_ID_PREFIX_CANDIDATE_LIMIT
        ? `, …${candidateTraceIds.length - TRACE_ID_PREFIX_CANDIDATE_LIMIT} more`
        : "";
    super(
      `Trace ID prefix "${prefix}" is ambiguous — matches: ${preview}${suffix}. Use a longer prefix.`,
    );
    this.name = "AmbiguousTraceIdPrefixError";
  }
}

/** Traces a scenario run id may resolve to; more than one answers with the list. */
const SCENARIO_RUN_TRACE_LIMIT = 20;

type TraceAlternateIdMembers = Readonly<{
  store: Pick<
    TraceLegacyReadRepository,
    "resolveTraceIdByPrefix" | "resolveTraceIdsByScenarioRunId"
  >;
  mapping: Pick<LegacyTraceMappingService, "findTraceIdsBySpanId">;
}>;

/**
 * The trace an id names when it is not an exact trace id in the project (empty when none): a
 * unique hex prefix, a scenario run that produced one trace, or a span id. Refuses an ambiguous
 * prefix and a run with several traces, listing them.
 */
export class TraceAlternateIdService {
  static create(members: TraceAlternateIdMembers): TraceAlternateIdService {
    return new TraceAlternateIdService(members);
  }

  private constructor(private readonly members: TraceAlternateIdMembers) {}

  async find({
    authorization,
    projectId,
    traceId,
    onAmbiguousPrefix,
  }: {
    authorization: Authorization;
    projectId: string;
    traceId: string;
    onAmbiguousPrefix: () => void;
  }): Promise<{ traceId: string; resolvedFrom: TraceLookupResolvedFrom }[]> {
    const { store, mapping } = this.members;
    const now = nowInstant().epochMilliseconds;
    const window = {
      from: now - TRACE_ID_PREFIX_LOOKUP_WINDOW_DAYS * 24 * 60 * 60 * 1000,
      to: now,
    };
    if (
      traceId.length < FULL_TRACE_ID_LENGTH &&
      traceId.length >= MIN_TRACE_ID_PREFIX_LENGTH &&
      isHexId(traceId)
    ) {
      const candidates = await store.resolveTraceIdByPrefix({
        projectId,
        prefix: traceId,
        occurredAt: window,
        limit: TRACE_ID_PREFIX_CANDIDATE_LIMIT,
      });
      if (candidates.length > 1) {
        onAmbiguousPrefix();
        throw new AmbiguousTraceIdPrefixError(traceId, candidates);
      }
      if (candidates[0]) return [{ traceId: candidates[0], resolvedFrom: "trace_id_prefix" }];
    }

    if (isScenarioRunId(traceId)) {
      const runTraces = await store.resolveTraceIdsByScenarioRunId({
        authorization,
        projectId,
        scenarioRunId: traceId,
        occurredAt: window,
        limit: SCENARIO_RUN_TRACE_LIMIT,
      });
      if (runTraces.length > 1) throw new ScenarioRunHasManyTracesError(traceId, runTraces);
      return runTraces.map((id) => ({ traceId: id, resolvedFrom: "scenario_run_id" as const }));
    }

    if (!looksLikeSpanId(traceId)) return [];
    const holding = await mapping.findTraceIdsBySpanId({
      authorization,
      projectId,
      spanId: traceId,
      limit: 1,
    });
    return holding.map((id) => ({ traceId: id, resolvedFrom: "span_id" as const }));
  }
}
