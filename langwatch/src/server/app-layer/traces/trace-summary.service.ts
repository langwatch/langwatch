import { createLogger } from "@langwatch/observability";
import type { NormalizedSpan } from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import {
  hasEventRefs,
  parseSpanEventRefs,
} from "~/server/traces/offloaded-eventref-parsing";
import { resolveOffloadedTraces } from "~/server/traces/resolve-offloaded-traces";
import { ATTR_KEYS } from "./canonicalisation/extractors/_constants";
import { TraceNotFoundError } from "./errors";
import type {
  FindByTraceIdOptions,
  TraceSummaryRepository,
} from "./repositories/trace-summary.repository";
import type { SpanReadBlobResolutionDeps } from "./span-storage.service";
import type { TraceSummaryData } from "./types";
import { teaserOf } from "./visibility-window.service";

/**
 * IO attribute keys that can carry an ADR-022 eventref (mirrors
 * `lean-for-projection`'s `IO_ATTR_KEYS`, split by direction). Used to attribute
 * an unresolved eventref to the input vs output field for the best-effort
 * "content may be incomplete" signal (#5835 AC4).
 */
const INPUT_IO_ATTR_KEYS: ReadonlySet<string> = new Set([
  ATTR_KEYS.LANGWATCH_INPUT,
  ATTR_KEYS.GEN_AI_INPUT_MESSAGES,
]);
const OUTPUT_IO_ATTR_KEYS: ReadonlySet<string> = new Set([
  ATTR_KEYS.LANGWATCH_OUTPUT,
  ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES,
]);

/**
 * Narrow read port for a trace's RAW normalized spans (no blob resolution).
 * Satisfied by `SpanStorageService` — whose `getNormalizedSpansByTraceId`
 * delegates straight to the repository — so the composition root reuses that one
 * instance instead of re-deriving ClickHouse access here (#5835). Kept narrow so
 * the summary service depends only on the one method it needs.
 */
export interface TraceSpansReader {
  getNormalizedSpansByTraceId(params: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
  }): Promise<NormalizedSpan[]>;
}

/**
 * Optional read-time blob-offload resolution dependencies (ADR-022 / #5835).
 *
 * When provided, `getByTraceId` restores the FULL trace-level input/output from
 * event_log — recomputed via the fold's own winner-selection over the resolved
 * spans — BEFORE the visibility gate runs, so the Summary panel shows the
 * complete content the 64 KB preview in `trace_summaries` truncated. When
 * omitted, the service returns the stored preview values unchanged (identical to
 * pre-#5835 behaviour).
 *
 * Extends the span read path's {@link SpanReadBlobResolutionDeps} with a
 * `spansReader`: unlike `SpanStorageService` the summary service does not own the
 * span read, so it needs a port to fetch the trace's spans (the eventref
 * pointers live on span attributes). The three are a unit — resolution needs all
 * of them or none, which is why they travel as one optional object.
 */
export interface TraceSummaryBlobResolutionDeps
  extends SpanReadBlobResolutionDeps {
  spansReader: TraceSpansReader;
}

export class TraceSummaryService {
  private readonly logger = createLogger(
    "langwatch:traces:trace-summary-service",
  );

  constructor(
    readonly repository: TraceSummaryRepository,
    private readonly blobResolutionDeps?: TraceSummaryBlobResolutionDeps,
  ) {}

  async upsert(data: TraceSummaryData, tenantId: string): Promise<void> {
    await this.repository.upsert(data, tenantId);
  }

  async getByTraceId(
    tenantId: string,
    traceId: string,
    options?: FindByTraceIdOptions & {
      /**
       * Read-side visibility gate: summaries that occurred before this
       * cutoff get computed input/output/error teaser-redacted.
       * Omitted/null = ungated (internal callers).
       */
      visibilityCutoffMs?: number | null;
    },
  ): Promise<TraceSummaryData> {
    const stored = await this.repository.findByTraceId(
      tenantId,
      traceId,
      options,
    );
    if (!stored) throw new TraceNotFoundError(traceId);

    // ADR-022 read-time resolution runs FIRST: overlay the full IO (and detect
    // any unresolved eventref) BEFORE the visibility gate below. This ordering
    // is load-bearing — a pre-cutoff trace must still be teaser-redacted on the
    // RESOLVED value so full content never leaks past the visibility window
    // (#5835 AC1 + AC10).
    const result = await this.resolveOffloadedIO({
      tenantId,
      traceId,
      stored,
      occurredAtMs: options?.occurredAtMs,
    });

    const cutoff = options?.visibilityCutoffMs;
    if (cutoff === null || cutoff === undefined || result.occurredAt >= cutoff) {
      return result;
    }
    return {
      ...result,
      computedInput: result.computedInput
        ? teaserOf(result.computedInput)
        : result.computedInput,
      computedOutput: result.computedOutput
        ? teaserOf(result.computedOutput)
        : result.computedOutput,
      errorMessage: result.errorMessage
        ? teaserOf(result.errorMessage)
        : result.errorMessage,
      redactedByVisibilityWindow: true,
    };
  }

  /**
   * Restores the trace's full computed input/output from event_log (ADR-022)
   * and flags any IO field whose eventref could not be resolved. Returns
   * `stored` unchanged when no resolution deps were supplied (no-op fast path).
   *
   * Error policy mirrors {@link resolveOffloadedTraces}: a missing event_log row
   * keeps the stored preview in place and never throws — but the affected field
   * is flagged `inputTruncated` / `outputTruncated` so the UI can warn the
   * content may be incomplete.
   */
  private async resolveOffloadedIO({
    tenantId,
    traceId,
    stored,
    occurredAtMs,
  }: {
    tenantId: string;
    traceId: string;
    stored: TraceSummaryData;
    occurredAtMs?: number;
  }): Promise<TraceSummaryData> {
    const deps = this.blobResolutionDeps;
    if (!deps) return stored;

    const normalizedSpans = await deps.spansReader.getNormalizedSpansByTraceId({
      tenantId,
      traceId,
      ...(occurredAtMs !== undefined ? { occurredAtMs } : {}),
    });

    // Which IO directions carried an eventref BEFORE resolution — the basis for
    // the "content may be incomplete" signal below.
    const { inputHadRef, outputHadRef } =
      detectOffloadedIOFields(normalizedSpans);

    const { recomputedInput, recomputedOutput, anyResolved } =
      await resolveOffloadedTraces({
        projectId: tenantId,
        normalizedSpans,
        blobStore: deps.blobStore,
        ioExtractionService: deps.ioExtractionService,
        logger: this.logger,
      });

    const resolved: TraceSummaryData = { ...stored };

    // Overlay the recomputed full content only when a span actually resolved.
    // recomputed* can still be null when the fold found no IO in the resolved
    // spans — keep the stored value in that case rather than blanking it.
    if (anyResolved) {
      if (recomputedInput !== null) {
        resolved.computedInput = recomputedInput.text;
      }
      if (recomputedOutput !== null) {
        resolved.computedOutput = recomputedOutput.text;
      }
    }

    // A field is truncated when it HAD a ref but resolution did not cover it
    // (nothing resolved at all, or the recompute came back null for that field).
    // Invariants: no ref → never flagged; ref resolved → never flagged; ref that
    // failed to resolve → flagged.
    if (inputHadRef && (!anyResolved || recomputedInput === null)) {
      resolved.inputTruncated = true;
    }
    if (outputHadRef && (!anyResolved || recomputedOutput === null)) {
      resolved.outputTruncated = true;
    }

    return resolved;
  }
}

/**
 * Detects which trace-level IO directions carried an ADR-022 eventref, decoding
 * pointers through the shared {@link parseSpanEventRefs} so the eventref shape is
 * parsed in exactly one place.
 *
 * Best-effort across ALL spans (not just the fold's winner): computing the
 * winner here would duplicate the fold's selection algorithm. Over-flagging is
 * bounded to the rare shape where a non-winning span's ref fails while the
 * winning span's value was complete — acceptable for a narrow "may be
 * incomplete" hint. `missingEventIdKeys` count too: a ref with no usable eventId
 * cannot be resolved, so its field is likewise still a preview.
 */
function detectOffloadedIOFields(spans: NormalizedSpan[]): {
  inputHadRef: boolean;
  outputHadRef: boolean;
} {
  let inputHadRef = false;
  let outputHadRef = false;
  for (const span of spans) {
    const attrs = span.spanAttributes as Record<string, string>;
    if (!hasEventRefs(attrs)) continue;
    const { eventrefEntries, missingEventIdKeys } = parseSpanEventRefs(attrs);
    const refAttrKeys = [
      ...eventrefEntries.map((entry) => entry.attrKey),
      ...missingEventIdKeys,
    ];
    for (const attrKey of refAttrKeys) {
      if (INPUT_IO_ATTR_KEYS.has(attrKey)) inputHadRef = true;
      else if (OUTPUT_IO_ATTR_KEYS.has(attrKey)) outputHadRef = true;
    }
  }
  return { inputHadRef, outputHadRef };
}
