import { createLogger } from "@langwatch/observability";
import type { NormalizedSpan } from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import { overlayResolvedIO } from "~/server/traces/offload-truncation-detection";
import { resolveOffloadedTraces } from "~/server/traces/resolve-offloaded-traces";
import { TraceNotFoundError } from "./errors";
import type {
  FindByTraceIdOptions,
  TraceSummaryRepository,
} from "./repositories/trace-summary.repository";
import type { SpanReadBlobResolutionDeps } from "./span-storage.service";
import type { TraceSummaryData } from "./types";
import { teaserOf } from "./visibility-window.service";

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
   * content may be incomplete. The overlay + flagging rule itself is the shared
   * {@link overlayResolvedIO} helper, also used by `TraceListService`'s
   * `resolveFullIOForRows` (#5835), so the rule lives in exactly one place.
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

    const resolved = await resolveOffloadedTraces({
      projectId: tenantId,
      normalizedSpans,
      blobStore: deps.blobStore,
      ioExtractionService: deps.ioExtractionService,
      logger: this.logger,
    });

    return overlayResolvedIO(stored, normalizedSpans, resolved);
  }
}
