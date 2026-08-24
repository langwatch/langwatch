import { createLogger } from "@langwatch/observability";
import {
  SpanKind as ApiSpanKind,
  type Span as OtelSpan,
} from "@opentelemetry/api";
import type { IExportTraceServiceRequest } from "@opentelemetry/otlp-transformer";
import { getLangWatchTracer } from "langwatch";
import type {
  PIIRedactionLevel,
  RecordSpanCommandData,
} from "../../event-sourcing/pipelines/trace-processing/schemas/commands";
import {
  instrumentationScopeSchema,
  type OtlpInstrumentationScope,
  type OtlpResource,
  type OtlpSpan,
  resourceSchema,
  spanSchema,
} from "../../event-sourcing/pipelines/trace-processing/schemas/otlp";
import { TraceRequestUtils } from "../../event-sourcing/pipelines/trace-processing/utils/traceRequest.utils";
import { shouldFilterCodingAgentSpan } from "./coding-agent-span-filter";
import type { SpanDedupService } from "./span-dedupe.service";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Maximum span age accepted at ingestion. Spans older than this are dropped on
 * both the OTLP path (processSpan) and the REST collector (routes/collector.ts)
 * so arbitrarily old timestamps never land in cold ClickHouse partitions.
 */
export const SPAN_MAX_PAST_MS = 31 * ONE_DAY_MS;

export type SpanIngestionStatus =
  | "collected"
  | "dropped"
  | "deduped"
  | "failed"
  // A pure-infra span from a noisy coding-agent tool (codex/opencode) that the
  // ingestion filter intentionally drops before the dedup gate. Distinct from
  // "dropped" (parse/age failures) so the counts stay legible.
  | "filtered";

/**
 * Why a span was rejected at ingestion. Used to break the rejected count down
 * by parser reason on the ingestion tracer span (issue #5898 acceptance
 * criterion 5). Only meaningful for `dropped`/`failed` statuses; absent on
 * success/dedup/filtered paths.
 */
export type SpanDropReason =
  | "validation"
  | "age"
  | "queue";

export interface SpanIngestionResult {
  status: SpanIngestionStatus;
  error?: string;
  dropReason?: SpanDropReason;
}

/**
 * Cap the error message we surface in `partialSuccess.errorMessage` so a single
 * bad batch with hundreds of malformed spans cannot blow the response size or
 * swallow the actionable prefix in a wall of repeated text. The OTLP spec lets
 * receivers truncate `partialSuccess.errorMessage` arbitrarily; we keep the
 * first few distinct errors verbatim and append "+N more" if there are more.
 */
const MAX_DISTINCT_ERRORS_IN_RESPONSE = 5;
const MAX_SINGLE_ERROR_CHARS = 500;

/**
 * Stable, public-safe messages surfaced in `partialSuccess.errorMessage` per
 * rejection reason. Raw exception messages (Redis/queue `error.message`, Zod
 * parse diagnostics) are intentionally NOT reflected here — a customer holding
 * an ingest key can deliberately trigger queue failures and would otherwise
 * receive infrastructure/library details. The raw error is retained in
 * `this.logger.error` and `otelSpanRef.addEvent("span_ingestion_error")` for
 * server-side debugging.
 */
const PUBLIC_REJECTION_MESSAGE: Record<SpanDropReason, string> = {
  validation: "span validation failed",
  age: "span start time is more than 31 days in the past",
  queue: "ingestion queue error",
};

function truncateError(msg: string): string {
  if (msg.length <= MAX_SINGLE_ERROR_CHARS) return msg;
  return `${msg.slice(0, MAX_SINGLE_ERROR_CHARS - 3)}...`;
}

/**
 * Build a bounded error message from the per-span error list. De-duplicates
 * first because a misconfigured SDK will often produce the same parse error
 * for every span in a batch, then truncates each individual error and caps the
 * count. The result is what callers see in `partialSuccess.errorMessage`.
 *
 * Exported so the bounding contract can be unit-tested without a tRPC client.
 */
export function buildBoundedErrorMessage(errors: string[]): string {
  // Preserve insertion order while de-duplicating. A batch that fails the same
  // way 200 times should still surface one entry, not 200.
  const seen = new Set<string>();
  const distinct: string[] = [];
  for (const e of errors) {
    if (!seen.has(e)) {
      seen.add(e);
      distinct.push(e);
    }
  }
  if (distinct.length === 0) return "";
  const shown = distinct.slice(0, MAX_DISTINCT_ERRORS_IN_RESPONSE).map(truncateError);
  const remaining = distinct.length - shown.length;
  if (remaining > 0) {
    return `${shown.join("; ")}; +${remaining} more`;
  }
  return shown.join("; ");
}

/** An OtlpSpan whose ID fields have been normalized to hex strings. */
type NormalizedIdSpan = OtlpSpan & { traceId: string; spanId: string };

/**
 * Normalizes all ID fields in a span to hex strings before queuing.
 * This prevents issues with Uint8Array serialization through JSON (queue/Redis),
 * where Uint8Array becomes {"0": 133, "1": 93, ...} objects.
 */
function normalizeSpanIds(span: OtlpSpan): NormalizedIdSpan {
  return {
    ...span,
    traceId: TraceRequestUtils.normalizeOtlpId(span.traceId),
    spanId: TraceRequestUtils.normalizeOtlpId(span.spanId),
    parentSpanId: span.parentSpanId
      ? TraceRequestUtils.normalizeOtlpId(span.parentSpanId)
      : span.parentSpanId,
    links: span.links.map((link) => ({
      ...link,
      traceId: TraceRequestUtils.normalizeOtlpId(link.traceId),
      spanId: TraceRequestUtils.normalizeOtlpId(link.spanId),
    })),
  };
}

export interface TraceRequestCollectionResult {
  /**
   * Spans that did not reach storage: parse/age drops plus dispatch failures.
   * Kept as the single headline number the HTTP receivers echo back.
   */
  rejectedSpans: number;
  /**
   * The subset of `rejectedSpans` that failed to *dispatch* — an exception out
   * of `recordSpan`, i.e. the queue, Redis, or the edge hook being unavailable.
   *
   * Split out from the total because the two halves have opposite retry
   * answers. A drop is permanent (a span that fails `spanSchema` fails it every
   * time; a span older than `SPAN_MAX_PAST_MS` is older still on the next
   * attempt), so a caller that retries on drops never stops retrying. A
   * dispatch failure is transient, so a caller with a durable cursor — the
   * ingestion puller — MUST treat it as a failed run or the window advances
   * over spans that never landed.
   */
  ingestionFailures: number;
  /**
   * Only the dispatch failures' messages, for a caller that retries on them and
   * has to say what it is retrying for.
   *
   * `errorMessage` below is unsuitable for that: it also carries drop reasons,
   * which describe a different span than the one that failed to dispatch, and a
   * rejected span's serialized schema error runs to kilobytes — a payload that
   * would follow the caller into whatever durable store it records failures in.
   */
  ingestionFailureMessage: string;
  errorMessage: string;
}

export interface TraceRequestCollectionDeps {
  dedup: SpanDedupService;
  recordSpan: (data: RecordSpanCommandData) => Promise<void>;
  /**
   * Optional edge command-data hook (ADR-022). When provided, receives the fully
   * assembled RecordSpanCommandData before it is sent to the queue and may return
   * a modified version (e.g., with `spoolRef` set and span attributes cleared for
   * over-threshold payloads). Flag-gated by the composition root on
   * `release_trace_blob_offload`; absent ⇒ unchanged behavior.
   *
   * FAIL-OPEN: errors from this hook are caught by the composition root wrapper
   * and log at warn level, returning the original commandData unchanged.
   */
  processCommandData?: (
    data: RecordSpanCommandData,
  ) => Promise<RecordSpanCommandData>;
}

/**
 * Per-request tally of span outcomes, and the one place that decides what each
 * outcome means to a caller.
 *
 * It exists as its own unit because two of those decisions are load-bearing and
 * were previously inline: filtered spans are NOT rejections, and drops and
 * dispatch failures are rejections with opposite retry answers (see
 * `TraceRequestCollectionResult`).
 */
class SpanIngestionTally {
  private collected = 0;
  private dropped = 0;
  private deduped = 0;
  private filtered = 0;
  private failed = 0;
  // Per-reason breakdown of rejected spans (issue #5898 acceptance
  // criterion 5). The set of keys is closed (validation/age/queue) so a
  // numeric counter per key is enough — no need for a Map.
  private rejectedByValidation = 0;
  private rejectedByAge = 0;
  private rejectedByQueue = 0;
  private readonly errors: string[] = [];
  private readonly failureErrors: string[] = [];

  record(result: SpanIngestionResult): void {
    switch (result.status) {
      case "collected":
        this.collected++;
        break;
      case "dropped":
        this.dropped++;
        if (result.dropReason === "validation") this.rejectedByValidation++;
        else if (result.dropReason === "age") this.rejectedByAge++;
        break;
      case "deduped":
        this.deduped++;
        break;
      case "filtered":
        this.filtered++;
        break;
      case "failed":
        this.failed++;
        if (result.dropReason === "queue") this.rejectedByQueue++;
        if (result.error) this.failureErrors.push(result.error);
        break;
    }
    if (result.error) this.errors.push(result.error);
  }

  annotate(span: OtelSpan): void {
    span.setAttribute("spans.ingestion.successes", this.collected);
    span.setAttribute("spans.ingestion.failures", this.failed);
    span.setAttribute("spans.ingestion.drops", this.dropped);
    span.setAttribute("spans.ingestion.deduped", this.deduped);
    span.setAttribute("spans.ingestion.filtered", this.filtered);
    // Rejected-span breakdown by rejection reason. Emitted as separate
    // attributes so dashboards can sum any slice without parsing a JSON
    // blob, and so the existing `spans.ingestion.drops`/`failures`
    // attributes stay back-compatible.
    span.setAttribute(
      "spans.ingestion.rejected.by_reason.validation",
      this.rejectedByValidation,
    );
    span.setAttribute(
      "spans.ingestion.rejected.by_reason.age",
      this.rejectedByAge,
    );
    span.setAttribute(
      "spans.ingestion.rejected.by_reason.queue",
      this.rejectedByQueue,
    );
  }

  toResult(): TraceRequestCollectionResult {
    return {
      // Filtered spans are intentionally not stored (coding-agent infra
      // noise), so they are NOT rejections.
      rejectedSpans: this.dropped + this.failed,
      ingestionFailures: this.failed,
      ingestionFailureMessage: this.failureErrors.join("; "),
      errorMessage: this.errors.join("; "),
    };
  }
}

/**
 * Service for collecting trace requests into the trace processing pipeline.
 *
 * Normalizes OTLP trace requests and sends each span as a span-received event
 * into the trace processing pipeline.
 */
export class TraceRequestCollectionService {
  private readonly tracer = getLangWatchTracer(
    "langwatch.trace-processing.span-ingestion",
  );
  private readonly logger = createLogger(
    "langwatch:trace-processing:span-ingestion",
  );

  constructor(private readonly deps: TraceRequestCollectionDeps) {}

  /**
   * Deserializes the OTLP request (JSON or protobuf), iterates through all spans,
   * normalizing the data into a more stable data structure, and sends each span to the
   * trace processing pipeline as span received events.
   */
  async handleOtlpTraceRequest(
    tenantId: string,
    traceRequest: IExportTraceServiceRequest,
    piiRedactionLevel: PIIRedactionLevel,
  ): Promise<TraceRequestCollectionResult> {
    return await this.tracer.withActiveSpan(
      "TraceRequestCollectionService.handleOtlpTraceRequest",
      {
        kind: ApiSpanKind.PRODUCER,
        attributes: {
          "tenant.id": tenantId,
          trace_request_count: traceRequest.resourceSpans?.length ?? 0,
        },
      },
      async (span) => {
        const tally = new SpanIngestionTally();

        for (const resourceSpan of traceRequest.resourceSpans ?? []) {
          const resource = resourceSpan?.resource;
          const resourceParseResult = resourceSchema.safeParse(resource);
          if (!resourceParseResult.success) {
            this.logger.error(
              { result: resourceParseResult, tenantId },
              "Error parsing OTLP resource",
            );
          }

          for (const scopeSpan of resourceSpan?.scopeSpans ?? []) {
            const scope = scopeSpan?.scope;
            const scopeParseResult =
              instrumentationScopeSchema.safeParse(scope);
            if (!scopeParseResult.success) {
              this.logger.error(
                { result: scopeParseResult, tenantId },
                "Error parsing OTLP scope",
              );
            }

            for (const otelSpan of scopeSpan?.spans ?? []) {
              const result = await this.processSpan({
                tenantId,
                otelSpan,
                resource: resourceParseResult.data ?? null,
                scope: scopeParseResult.data ?? null,
                piiRedactionLevel,
                otelSpanRef: span,
              });

              tally.record(result);
            }
          }
        }

        tally.annotate(span);
        return tally.toResult();
      },
    );
  }

  /**
   * Dedup-gated dispatch of a single span into the trace processing pipeline.
   *
   * Both the OTLP collector (via `handleOtlpTraceRequest`) and the REST
   * `/api/collector` endpoint must route through this method so that a
   * retry storm on either path cannot bypass the `(tenant, trace, span)`
   * dedup gate and accumulate duplicate `recordSpan` jobs in the
   * event-sourcing group queue.
   *
   * The caller is responsible for delivering an already-parsed `OtlpSpan`
   * with hex-normalised id fields (use `normalizeSpanIds` for OTLP input,
   * or `CollectorSpanUtils.convertSpanToOtlp` for the REST path).
   */
  async ingestNormalizedSpan({
    tenantId,
    span,
    resource,
    instrumentationScope,
    piiRedactionLevel,
    otelSpanRef,
  }: {
    tenantId: string;
    span: OtlpSpan;
    resource: OtlpResource | null;
    instrumentationScope: OtlpInstrumentationScope | null;
    piiRedactionLevel: PIIRedactionLevel;
    otelSpanRef?: OtelSpan;
  }): Promise<SpanIngestionResult> {
    let lockAcquired = false;

    try {
      const lockResult = await this.deps.dedup.tryAcquireProcessingLock(
        tenantId,
        span.traceId,
        span.spanId,
      );
      if (lockResult === false) {
        return { status: "deduped" };
      }
      lockAcquired = lockResult === true;

      // ADR-022: Assemble the full command data, then pass it through the
      // optional processCommandData hook (edge size-check + spool). No-op
      // when the hook is absent (flag-gated by the composition root).
      const baseCommandData: RecordSpanCommandData = {
        tenantId,
        span,
        resource,
        instrumentationScope,
        piiRedactionLevel,
        occurredAt: Date.now(),
      };

      const commandData = this.deps.processCommandData
        ? await this.deps.processCommandData(baseCommandData)
        : baseCommandData;

      await this.deps.recordSpan(commandData);

      await this.deps.dedup.tryConfirmProcessed(
        tenantId,
        span.traceId,
        span.spanId,
      );

      return { status: "collected" };
    } catch (error) {
      if (lockAcquired) {
        await this.deps.dedup.tryReleaseOnFailure(
          tenantId,
          span.traceId,
          span.spanId,
        );
      }

      otelSpanRef?.addEvent("span_ingestion_error", {
        "error.message": error instanceof Error ? error.message : String(error),
        "tenant.id": tenantId,
      });
      this.logger.error(
        {
          error,
          tenantId,
          traceId: span.traceId,
          spanId: span.spanId,
        },
        "Error dispatching span to the trace processing pipeline",
      );
      return {
        status: "failed",
        error: PUBLIC_REJECTION_MESSAGE.queue,
        dropReason: "queue",
      };
    }
  }

  private async processSpan({
    tenantId,
    otelSpan,
    resource,
    scope,
    piiRedactionLevel,
    otelSpanRef,
  }: {
    tenantId: string;
    otelSpan: unknown;
    resource: OtlpResource | null;
    scope: OtlpInstrumentationScope | null;
    piiRedactionLevel: PIIRedactionLevel;
    otelSpanRef: OtelSpan;
  }): Promise<SpanIngestionResult> {
    const spanParseResult = spanSchema.safeParse(otelSpan);
    if (!spanParseResult.success) {
      this.logger.warn(
        { result: spanParseResult, tenantId },
        "Error parsing OTLP span, dropping",
      );
    }
    if (!spanParseResult.data) {
      const fieldPaths = [
        ...new Set(
          (spanParseResult.error?.issues ?? [])
            .map((issue) => issue.path.join("."))
            .filter((path) => path.length > 0),
        ),
      ].sort();
      return {
        status: "dropped",
        error: fieldPaths.length
          ? `${PUBLIC_REJECTION_MESSAGE.validation}: ${fieldPaths.join(", ")}`
          : PUBLIC_REJECTION_MESSAGE.validation,
        dropReason: "validation",
      };
    }

    const startTimeUnixMs = TraceRequestUtils.convertUnixNanoToUnixMs(
      TraceRequestUtils.normalizeOtlpUnixNano(
        spanParseResult.data.startTimeUnixNano,
      ),
    );
    const now = Date.now();

    if (startTimeUnixMs < now - SPAN_MAX_PAST_MS) {
      return {
        status: "dropped",
        error: PUBLIC_REJECTION_MESSAGE.age,
        dropReason: "age",
      };
    }

    // Drop pure-infra spans from the noisy coding-agent tools (codex/opencode)
    // so their traces read like claude's and the infra-only fragment traces
    // never get created. Scoped to those two instrumentation scopes; all other
    // OTLP is untouched. Opt out globally with the kill-switch env var. Runs
    // before the dedup gate so a filtered span never takes a processing lock.
    if (
      process.env.LANGWATCH_DISABLE_CODING_AGENT_SPAN_FILTER !== "true" &&
      shouldFilterCodingAgentSpan({
        scopeName: scope?.name,
        spanName: spanParseResult.data.name,
        attributeKeys: spanParseResult.data.attributes.map((a) => a.key),
      })
    ) {
      return { status: "filtered" };
    }

    return await this.ingestNormalizedSpan({
      tenantId,
      span: normalizeSpanIds(spanParseResult.data),
      resource,
      instrumentationScope: scope,
      piiRedactionLevel,
      otelSpanRef,
    });
  }
}
