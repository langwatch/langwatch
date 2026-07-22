import { createLogger } from "@langwatch/observability";
import { resolveOffloadedTraces } from "~/server/traces/resolve-offloaded-traces";
import type { BlobStore } from "./blob-store.service";
import { TraceNotFoundError } from "./errors";
import type {
  FindByTraceIdOptions,
  TraceSummaryRepository,
} from "~/server/event-sourcing/ports/trace-summary.repository";
import type { SpanStorageRepository } from "./repositories/span-storage.repository";
import type { TraceIOExtractionService } from "~/server/event-sourcing/pipelines/trace-processing/trace-io-extraction.service";
import type { TraceSummaryData } from "~/server/domain/traces/types";
import { teaserOf } from "./visibility-window.service";

const logger = createLogger(
  "langwatch:app-layer:traces:trace-summary-service",
);

/**
 * Optional blob-offload resolution deps for the v2 trace-header read path
 * (ADR-022). When provided, `getByTraceId({ full: true })` re-fetches the
 * trace's spans, resolves any `langwatch.reserved.eventref.*` pointer via
 * `resolveOffloadedTraces` (the same primitive SpanStorageService already
 * uses for per-span resolution), and recomputes computedInput/computedOutput
 * from the resolved spans. When omitted, `full` is a no-op and the stored
 * ≤64KB preview is returned unchanged — identical to pre-ADR-022 behaviour.
 */
export interface TraceSummaryFullResolutionDeps {
  spanStorageRepository: SpanStorageRepository;
  blobStore: BlobStore;
  ioExtractionService: TraceIOExtractionService;
}

export class TraceSummaryService {
  constructor(
    readonly repository: TraceSummaryRepository,
    private readonly fullResolutionDeps?: TraceSummaryFullResolutionDeps,
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
      /**
       * When true AND full-resolution deps were supplied at construction,
       * resolves any offloaded (ADR-022) input/output before returning —
       * see `TraceSummaryFullResolutionDeps`. Default (undefined/false)
       * returns the stored preview: no extra spans/event_log read. Only
       * ever pass true for a single-trace read (the drawer), never for a
       * list page — full resolution costs one spans read per trace.
       */
      full?: boolean;
    },
  ): Promise<TraceSummaryData> {
    const found = await this.repository.findByTraceId(
      tenantId,
      traceId,
      options,
    );
    if (!found) throw new TraceNotFoundError(traceId);

    const result = options?.full
      ? await this.resolveFullIO(tenantId, traceId, found, options)
      : found;

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
   * Resolves offloaded input/output for a single trace read. Never throws —
   * any failure (missing event_log row, resolution error) logs a warning
   * and falls back to the stored preview, matching resolveOffloadedTraces'
   * own fail-open contract.
   */
  private async resolveFullIO(
    tenantId: string,
    traceId: string,
    summary: TraceSummaryData,
    options?: FindByTraceIdOptions,
  ): Promise<TraceSummaryData> {
    if (!this.fullResolutionDeps) return summary;

    try {
      const normalizedSpans =
        await this.fullResolutionDeps.spanStorageRepository.getNormalizedSpansByTraceId(
          {
            tenantId,
            traceId,
            ...(options?.occurredAtMs !== undefined
              ? { occurredAtMs: options.occurredAtMs }
              : {}),
          },
        );
      const { recomputedInput, recomputedOutput, anyResolved } =
        await resolveOffloadedTraces({
          projectId: tenantId,
          normalizedSpans,
          blobStore: this.fullResolutionDeps.blobStore,
          ioExtractionService: this.fullResolutionDeps.ioExtractionService,
          logger,
        });

      if (!anyResolved) return summary;

      return {
        ...summary,
        computedInput: recomputedInput?.text ?? summary.computedInput,
        computedOutput: recomputedOutput?.text ?? summary.computedOutput,
      };
    } catch (error) {
      logger.warn(
        {
          tenantId,
          traceId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to resolve full trace IO — keeping the stored preview",
      );
      return summary;
    }
  }
}
