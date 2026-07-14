/**
 * Deja View normalisation preview.
 *
 * Replays an aggregate's stored span-received events through the CURRENT
 * span-normalisation pipeline (the same code the spanStorage map
 * projection runs at ingest time) and reports what today's build
 * produces, side by side with what is stored. Canonicalisation runs
 * inside a map projection, so its output is frozen at ingest — Deja
 * View's fold-projection replay can't exercise it; this service closes
 * that gap. Optional experimental mapping rules (regex blocks or bonsai
 * expressions) run on top so operators can prototype a vendor mapping
 * before writing an extractor.
 *
 * When rules are supplied, the preview also folds every Deja View
 * projection that consumes this aggregate's events twice — once over the
 * replayed (no rules) events and once with the rules applied — and
 * reports the state diff, so a rule's downstream impact on projections
 * is visible before it exists anywhere real. Rules apply across all span
 * events for the fold: projections accumulate state over the whole event
 * stream, so a per-event fold is not meaningful.
 *
 * Strictly read-only: nothing is stored, queued, or emitted.
 */

import { CanonicalizeSpanAttributesService } from "~/server/app-layer/traces/canonicalisation";
import { SpanNormalizationPipelineService } from "~/server/app-layer/traces/span-normalization.service";
import {
  getDejaViewProjections,
  getProjectionMetadata,
} from "~/server/event-sourcing/pipelineRegistry";
import { SPAN_RECEIVED_EVENT_TYPE } from "~/server/event-sourcing/pipelines/trace-processing/schemas/constants";
import {
  type SpanReceivedEventData,
  spanReceivedEventDataSchema,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/events";
import type { NormalizedSpan } from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import { createLogger } from "~/utils/logger/server";
import {
  applyMappingRules,
  type ApplyMappingRulesResult,
  type CompiledRule,
  compileMappingRules,
  type MappingRule,
} from "./normalisation-preview.rules";
import type {
  EventExplorerRepository,
  RawEventRow,
} from "./repositories/event-explorer.repository";

const MAX_EVENTS = 500;

/** Attribute-level difference between two attribute maps. */
export type AttributeDiffEntry = {
  key: string;
  kind: "added" | "removed" | "changed";
  before: string | null;
  after: string | null;
  /**
   * For rule-produced entries: the attribute key the value came from
   * (null for expression rules, which draw on the whole span) and the
   * rule that wrote it. Absent on entries not produced by a rule.
   */
  sourceKey?: string | null;
  ruleIndex?: number;
};

export type SpanNormalisationPreview = {
  eventId: string;
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
  /** Per-rule runtime errors on this span (expression rules). */
  ruleErrors: Array<{ ruleIndex: number; error: string }>;
};

export type ProjectionImpact = {
  projectionName: string;
  aggregateType: string;
  appliedEventCount: number;
  /** Flattened state diff: fold(replayed events) vs fold(rules applied). */
  changes: AttributeDiffEntry[];
};

export type NormalisationPreviewResult = {
  spans: SpanNormalisationPreview[];
  /** Per-rule match statistics aggregated across ALL replayed spans. */
  ruleStats: Array<{ ruleIndex: number; matchedSpanCount: number }>;
  /** Rule impact on every projection folding this aggregate's events. */
  projections: ProjectionImpact[];
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

type ReplayedRow = {
  row: RawEventRow;
  data: SpanReceivedEventData;
  span: NormalizedSpan;
  appliedRules: string[];
  ruleRun: ApplyMappingRulesResult | null;
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
    /** When set, only this event's span appears in `spans` (rules and projections still consider all events). */
    eventId?: string;
  }): Promise<NormalisationPreviewResult> {
    // Compiles (and thereby validates) rules before any replay work so an
    // invalid regex or expression rejects the run as a whole.
    const compiledRules = compileMappingRules(params.rules);

    const rows = await this.repo.findEventsByAggregate({
      aggregateId: params.aggregateId,
      tenantId: params.tenantId,
      limit: MAX_EVENTS,
    });

    const spanRowCount = rows.filter(
      (row) => row.eventType === SPAN_RECEIVED_EVENT_TYPE,
    ).length;

    const { replayedRows, skippedInvalidEvents } = this.replayRows(
      params.tenantId,
      rows,
      compiledRules,
    );

    const storedBySpanId = await this.fetchStoredSpans(params);

    const spans = replayedRows
      .filter(
        (replayed) =>
          params.eventId === undefined ||
          replayed.row.eventId === params.eventId,
      )
      .map((replayed) => this.toSpanPreview(replayed, storedBySpanId));

    const ruleMatchedSpans = new Map<number, number>();
    for (const replayed of replayedRows) {
      for (const result of replayed.ruleRun?.ruleResults ?? []) {
        if (result.matchedKeys.length > 0 || result.writes.length > 0) {
          ruleMatchedSpans.set(
            result.ruleIndex,
            (ruleMatchedSpans.get(result.ruleIndex) ?? 0) + 1,
          );
        }
      }
    }

    const projections =
      compiledRules.length > 0
        ? this.computeProjectionImpact(params, rows, replayedRows)
        : [];

    return {
      spans,
      ruleStats: params.rules.map((_, ruleIndex) => ({
        ruleIndex,
        matchedSpanCount: ruleMatchedSpans.get(ruleIndex) ?? 0,
      })),
      projections,
      eventsScanned: rows.length,
      spanEventsFound: spanRowCount,
      skippedInvalidEvents,
    };
  }

  private replayRows(
    tenantId: string,
    rows: RawEventRow[],
    compiledRules: CompiledRule[],
  ): { replayedRows: ReplayedRow[]; skippedInvalidEvents: number } {
    const replayedRows: ReplayedRow[] = [];
    let skippedInvalidEvents = 0;

    for (const row of rows) {
      if (row.eventType !== SPAN_RECEIVED_EVENT_TYPE) continue;

      const payload = parseJsonPayload(row.payload);
      const parsed = spanReceivedEventDataSchema.safeParse(payload);
      if (!parsed.success) {
        skippedInvalidEvents++;
        this.logger.debug(
          { eventId: row.eventId },
          "Skipping span event whose payload does not parse as span-received data",
        );
        continue;
      }

      const { span, appliedRules } =
        this.normalizationPipeline.normalizeSpanReceivedWithDiagnostics(
          tenantId,
          parsed.data.span,
          parsed.data.resource,
          parsed.data.instrumentationScope,
        );

      replayedRows.push({
        row,
        data: parsed.data,
        span,
        appliedRules,
        ruleRun:
          compiledRules.length > 0
            ? applyMappingRules(span.spanAttributes, compiledRules)
            : null,
      });
    }

    return { replayedRows, skippedInvalidEvents };
  }

  private toSpanPreview(
    replayed: ReplayedRow,
    storedBySpanId: Map<string, NormalizedSpan> | null,
  ): SpanNormalisationPreview {
    const { row, span, appliedRules, ruleRun } = replayed;

    const stored = storedBySpanId?.get(span.spanId) ?? null;
    const storedDiff = stored
      ? diffAttributes(stored.spanAttributes, span.spanAttributes)
      : null;

    let rulesDiff: AttributeDiffEntry[] | null = null;
    const ruleErrors: Array<{ ruleIndex: number; error: string }> = [];
    if (ruleRun) {
      // Annotate rule-produced entries with the source key + rule that
      // wrote them (last write to a target wins, matching apply order).
      const writeByTarget = new Map<
        string,
        { sourceKey: string | null; ruleIndex: number }
      >();
      for (const result of ruleRun.ruleResults) {
        for (const write of result.writes) {
          writeByTarget.set(write.targetKey, {
            sourceKey: write.sourceKey,
            ruleIndex: result.ruleIndex,
          });
        }
        if (result.error !== null) {
          ruleErrors.push({ ruleIndex: result.ruleIndex, error: result.error });
        }
      }
      rulesDiff = diffAttributes(span.spanAttributes, ruleRun.attributes).map(
        (entry) => {
          const write = writeByTarget.get(entry.key);
          return write ? { ...entry, ...write } : entry;
        },
      );
    }

    return {
      eventId: row.eventId,
      spanId: span.spanId,
      traceId: span.traceId,
      name: span.name,
      replayedAttributes: span.spanAttributes,
      appliedRules,
      storedDiff,
      rulesDiff,
      ruleErrors,
    };
  }

  /**
   * Folds every Deja View projection that consumes this aggregate's event
   * types twice: over the replayed events (no rules) and over the events
   * with rules applied, then diffs the flattened states. Both sides carry
   * the replayed canonical attributes re-encoded into the event payload,
   * so the round-trip distortion cancels out and the diff is purely the
   * rules' effect.
   */
  private computeProjectionImpact(
    params: { aggregateId: string; tenantId: string },
    rows: RawEventRow[],
    replayedRows: ReplayedRow[],
  ): ProjectionImpact[] {
    const replayedByEventId = new Map(
      replayedRows.map((r) => [r.row.eventId, r]),
    );
    const eventTypesInAggregate = new Set(rows.map((r) => r.eventType));

    const aggregateTypeByProjection = new Map(
      getProjectionMetadata().map((p) => [p.projectionName, p.aggregateType]),
    );

    const impacts: ProjectionImpact[] = [];
    for (const projection of getDejaViewProjections()) {
      if (!projection.eventTypes.some((t) => eventTypesInAggregate.has(t))) {
        continue;
      }
      const aggregateType =
        aggregateTypeByProjection.get(projection.projectionName) ?? "";

      let before = projection.init();
      let after = projection.init();
      let appliedEventCount = 0;

      for (const row of rows) {
        if (!projection.eventTypes.includes(row.eventType)) continue;

        const replayed = replayedByEventId.get(row.eventId);
        const baselineData = replayed
          ? withSpanAttributes(replayed.data, replayed.span.spanAttributes)
          : parseJsonPayload(row.payload);
        const rulesData =
          replayed?.ruleRun !== null && replayed?.ruleRun !== undefined
            ? withSpanAttributes(replayed.data, replayed.ruleRun.attributes)
            : baselineData;

        const timestampMs = parseInt(row.eventTimestamp, 10);
        const makeEvent = (data: unknown) => ({
          id: row.eventId,
          aggregateId: params.aggregateId,
          aggregateType,
          tenantId: params.tenantId,
          createdAt: timestampMs,
          occurredAt: timestampMs,
          type: row.eventType,
          version: "",
          data,
        });

        try {
          before = projection.apply(before, makeEvent(baselineData));
          after = projection.apply(after, makeEvent(rulesData));
          appliedEventCount++;
        } catch (err) {
          this.logger.debug(
            {
              error: err,
              eventId: row.eventId,
              projectionName: projection.projectionName,
            },
            "Skipping event that failed to apply during projection impact computation",
          );
        }
      }

      impacts.push({
        projectionName: projection.projectionName,
        aggregateType,
        appliedEventCount,
        changes: diffAttributes(flattenState(before), flattenState(after)),
      });
    }

    return impacts;
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

const parseJsonPayload = (payload: unknown): unknown => {
  if (typeof payload !== "string") return payload;
  try {
    return JSON.parse(payload);
  } catch {
    return {};
  }
};

/**
 * Rebuilds a span-received event payload with the span's attributes
 * replaced by `attributes` (re-encoded as OTLP key-values). Everything
 * else on the payload is preserved.
 */
const withSpanAttributes = (
  data: SpanReceivedEventData,
  attributes: Record<string, unknown>,
): unknown => ({
  ...data,
  span: {
    ...data.span,
    attributes: Object.entries(attributes)
      .map(([key, value]) => ({ key, value: encodeOtlpValue(value) }))
      .filter((kv) => kv.value !== null),
  },
});

const encodeOtlpValue = (
  value: unknown,
): Record<string, unknown> | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { boolValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) && Number.isSafeInteger(value)
      ? { intValue: value }
      : { doubleValue: value };
  }
  try {
    const s = JSON.stringify(value);
    return typeof s === "string" ? { stringValue: s } : null;
  } catch {
    return null;
  }
};

const MAX_FLATTEN_DEPTH = 8;
const MAX_FLATTEN_KEYS = 2_000;

/**
 * Flattens arbitrary projection state into dotted-path leaves so two
 * states can be diffed with the same table the attribute diffs use.
 */
export function flattenState(state: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const walk = (value: unknown, path: string, depth: number): void => {
    if (Object.keys(out).length >= MAX_FLATTEN_KEYS) return;
    if (
      value === null ||
      typeof value !== "object" ||
      depth >= MAX_FLATTEN_DEPTH
    ) {
      out[path.length > 0 ? path : "(root)"] =
        value !== null && typeof value === "object"
          ? JSON.stringify(value)
          : value;
      return;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        out[path.length > 0 ? path : "(root)"] = "[]";
        return;
      }
      value.forEach((item, i) => walk(item, `${path}[${i}]`, depth + 1));
      return;
    }
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      out[path.length > 0 ? path : "(root)"] = "{}";
      return;
    }
    for (const [key, item] of entries) {
      walk(item, path.length > 0 ? `${path}.${key}` : key, depth + 1);
    }
  };
  walk(state, "", 0);
  return out;
}

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
