/**
 * Deja View normalisation preview.
 *
 * Replays an aggregate's stored span-received events through the CURRENT
 * span-normalisation pipeline (the same code the spanStorage map
 * projection runs at ingest time) and reports what today's build
 * produces, side by side with what is stored. Canonicalisation runs
 * inside a map projection, so its output is frozen at ingest — Deja
 * View's fold-projection replay can't exercise it; this service closes
 * that gap. Optional experimental mapping rules run on top so operators
 * can prototype a vendor mapping before writing an extractor.
 *
 * Strictly read-only: nothing is stored, queued, or emitted.
 */

import { CanonicalizeSpanAttributesService } from "~/server/app-layer/traces/canonicalisation";
import { SpanNormalizationPipelineService } from "~/server/app-layer/traces/span-normalization.service";
import { SPAN_RECEIVED_EVENT_TYPE } from "~/server/event-sourcing/pipelines/trace-processing/schemas/constants";
import { spanReceivedEventDataSchema } from "~/server/event-sourcing/pipelines/trace-processing/schemas/events";
import type { NormalizedSpan } from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import { createLogger } from "~/utils/logger/server";
import {
  applyMappingRules,
  compileMappingRules,
  type MappingRule,
  type MappingRuleResult,
} from "./normalisation-preview.rules";
import type { EventExplorerRepository } from "./repositories/event-explorer.repository";

const MAX_EVENTS = 500;

/** Attribute-level difference between two attribute maps. */
export type AttributeDiffEntry = {
  key: string;
  kind: "added" | "removed" | "changed";
  before: string | null;
  after: string | null;
};

export type SpanNormalisationPreview = {
  spanId: string;
  traceId: string;
  name: string;
  /** Attributes the current build produces from the raw event. */
  replayedAttributes: Record<string, unknown>;
  /** Canonicalisation rules that fired during the replay. */
  appliedRules: string[];
  /**
   * Diff of stored (ingest-time build) vs replayed (current build)
   * attributes. Empty when the current build reproduces storage exactly.
   * Null when the stored span could not be found for comparison.
   */
  storedDiff: AttributeDiffEntry[] | null;
  /**
   * Diff introduced by the experimental mapping rules, relative to the
   * replayed attributes. Null when no rules were supplied.
   */
  rulesDiff: AttributeDiffEntry[] | null;
};

export type NormalisationPreviewResult = {
  spans: SpanNormalisationPreview[];
  /** Per-rule match statistics aggregated across all replayed spans. */
  ruleStats: Array<{ ruleIndex: number; matchedSpanCount: number }>;
  eventsScanned: number;
  spanEventsFound: number;
  skippedInvalidEvents: number;
};

/**
 * The slice of SpanStorageService the preview needs to fetch stored spans
 * for the drift diff. Structural so tests can stub it and environments
 * without span storage can omit it (storedDiff is null then).
 */
export type StoredSpansReader = {
  getNormalizedSpansByTraceId(params: {
    tenantId: string;
    traceId: string;
  }): Promise<NormalizedSpan[]>;
};

export class NormalisationPreviewService {
  private readonly logger = createLogger("langwatch:ops:normalisation-preview");
  private readonly normalizationPipeline = new SpanNormalizationPipelineService(
    new CanonicalizeSpanAttributesService(),
  );

  constructor(
    private readonly repo: EventExplorerRepository,
    private readonly storedSpans: StoredSpansReader | null,
  ) {}

  async previewAggregate(params: {
    aggregateId: string;
    tenantId: string;
    rules: MappingRule[];
  }): Promise<NormalisationPreviewResult> {
    // Compiles (and thereby validates) rules before any replay work so an
    // invalid regex rejects the run as a whole.
    const compiledRules = compileMappingRules(params.rules);

    const rows = await this.repo.findEventsByAggregate({
      aggregateId: params.aggregateId,
      tenantId: params.tenantId,
      limit: MAX_EVENTS,
    });

    const spanRows = rows.filter(
      (row) => row.eventType === SPAN_RECEIVED_EVENT_TYPE,
    );

    const spans: SpanNormalisationPreview[] = [];
    const ruleMatchedSpans = new Map<number, number>();
    let skippedInvalidEvents = 0;

    const storedByspanId = await this.fetchStoredSpans(params);

    for (const row of spanRows) {
      let payload: unknown;
      try {
        payload =
          typeof row.payload === "string"
            ? JSON.parse(row.payload)
            : row.payload;
      } catch {
        skippedInvalidEvents++;
        continue;
      }

      const parsed = spanReceivedEventDataSchema.safeParse(payload);
      if (!parsed.success) {
        skippedInvalidEvents++;
        this.logger.debug(
          { eventId: row.eventId, aggregateId: params.aggregateId },
          "Skipping span event whose payload does not parse as span-received data",
        );
        continue;
      }

      const { span, appliedRules } =
        this.normalizationPipeline.normalizeSpanReceivedWithDiagnostics(
          params.tenantId,
          parsed.data.span,
          parsed.data.resource,
          parsed.data.instrumentationScope,
        );

      const stored = storedByspanId?.get(span.spanId) ?? null;
      const storedDiff = stored
        ? diffAttributes(stored.spanAttributes, span.spanAttributes)
        : null;

      let rulesDiff: AttributeDiffEntry[] | null = null;
      if (compiledRules.length > 0) {
        const ruleRun = applyMappingRules(span.spanAttributes, compiledRules);
        rulesDiff = diffAttributes(span.spanAttributes, ruleRun.attributes);
        countMatchedRules(ruleRun.ruleResults, ruleMatchedSpans);
      }

      spans.push({
        spanId: span.spanId,
        traceId: span.traceId,
        name: span.name,
        replayedAttributes: span.spanAttributes,
        appliedRules,
        storedDiff,
        rulesDiff,
      });
    }

    return {
      spans,
      ruleStats: params.rules.map((_, ruleIndex) => ({
        ruleIndex,
        matchedSpanCount: ruleMatchedSpans.get(ruleIndex) ?? 0,
      })),
      eventsScanned: rows.length,
      spanEventsFound: spanRows.length,
      skippedInvalidEvents,
    };
  }

  /**
   * Stored spans are keyed by spanId for the drift diff. Fetch failures
   * degrade to "no comparison" (storedDiff: null) — the replay itself is
   * still valuable when span storage is unreachable.
   */
  private async fetchStoredSpans(params: {
    aggregateId: string;
    tenantId: string;
  }): Promise<Map<string, NormalizedSpan> | null> {
    if (!this.storedSpans) return null;
    try {
      const stored = await this.storedSpans.getNormalizedSpansByTraceId({
        tenantId: params.tenantId,
        traceId: params.aggregateId,
      });
      return new Map(stored.map((s) => [s.spanId, s]));
    } catch (error) {
      this.logger.warn(
        { error, aggregateId: params.aggregateId },
        "Could not load stored spans for comparison; preview continues without storedDiff",
      );
      return null;
    }
  }
}

const countMatchedRules = (
  ruleResults: MappingRuleResult[],
  ruleMatchedSpans: Map<number, number>,
): void => {
  for (const result of ruleResults) {
    if (result.matchedKeys.length > 0) {
      ruleMatchedSpans.set(
        result.ruleIndex,
        (ruleMatchedSpans.get(result.ruleIndex) ?? 0) + 1,
      );
    }
  }
};

const MAX_DIFF_VALUE_LENGTH = 2_000;

const renderValue = (value: unknown): string => {
  const s = typeof value === "string" ? value : (JSON.stringify(value) ?? "");
  return s.length > MAX_DIFF_VALUE_LENGTH
    ? `${s.slice(0, MAX_DIFF_VALUE_LENGTH)}…`
    : s;
};

/**
 * Key-level diff of two attribute maps, values rendered as (truncated)
 * strings for display. Order: removed, changed, added — grouped by key
 * name within each kind for stable output.
 */
export function diffAttributes(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): AttributeDiffEntry[] {
  const entries: AttributeDiffEntry[] = [];
  const beforeKeys = new Set(Object.keys(before));
  const afterKeys = new Set(Object.keys(after));

  for (const key of [...beforeKeys].sort()) {
    if (!afterKeys.has(key)) {
      entries.push({
        key,
        kind: "removed",
        before: renderValue(before[key]),
        after: null,
      });
    }
  }
  for (const key of [...beforeKeys].sort()) {
    if (afterKeys.has(key)) {
      const beforeStr = renderValue(before[key]);
      const afterStr = renderValue(after[key]);
      if (beforeStr !== afterStr) {
        entries.push({ key, kind: "changed", before: beforeStr, after: afterStr });
      }
    }
  }
  for (const key of [...afterKeys].sort()) {
    if (!beforeKeys.has(key)) {
      entries.push({
        key,
        kind: "added",
        before: null,
        after: renderValue(after[key]),
      });
    }
  }
  return entries;
}
