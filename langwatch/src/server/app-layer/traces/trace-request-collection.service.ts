import { SpanKind as ApiSpanKind } from "@opentelemetry/api";
import type { IExportTraceServiceRequest } from "@opentelemetry/otlp-transformer";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "~/utils/logger/server";
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
const SPAN_MAX_PAST_MS = 31 * ONE_DAY_MS;

export type SpanIngestionStatus =
  | "collected"
  | "dropped"
  | "deduped"
  | "failed"
  // A pure-infra span from a noisy coding-agent tool (codex/opencode) that the
  // ingestion filter intentionally drops before the dedup gate. Distinct from
  // "dropped" (parse/age failures) so the counts stay legible.
  | "filtered";

export interface SpanIngestionResult {
  status: SpanIngestionStatus;
  error?: string;
}

/** An OtlpSpan whose ID fields have been normalized to hex strings. */
type NormalizedIdSpan = OtlpSpan & { traceId: string; spanId: string };

/**
 * Normalizes all ID fields in a span to hex strings before queuing.
 * This prevents issues with Uint8Array serialization through JSON (BullMQ/Redis),
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
  rejectedSpans: number;
  errorMessage: string;
}

export interface TraceRequestCollectionDeps {
  dedup: SpanDedupService;
  recordSpan: (data: RecordSpanCommandData) => Promise<void>;
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
        let collectedSpanCount = 0;
        let droppedSpanCount = 0;
        let dedupedSpanCount = 0;
        let ingestionFailureCount = 0;
        let filteredSpanCount = 0;
        const errors: string[] = [];

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

              switch (result.status) {
                case "collected":
                  collectedSpanCount++;
                  break;
                case "dropped":
                  droppedSpanCount++;
                  break;
                case "deduped":
                  dedupedSpanCount++;
                  break;
                case "filtered":
                  filteredSpanCount++;
                  break;
                case "failed":
                  ingestionFailureCount++;
                  break;
              }
              if (result.error) {
                errors.push(result.error);
              }
            }
          }
        }

        span.setAttribute("spans.ingestion.successes", collectedSpanCount);
        span.setAttribute("spans.ingestion.failures", ingestionFailureCount);
        span.setAttribute("spans.ingestion.drops", droppedSpanCount);
        span.setAttribute("spans.ingestion.deduped", dedupedSpanCount);
        span.setAttribute("spans.ingestion.filtered", filteredSpanCount);

        // Filtered spans are intentionally not stored (coding-agent infra
        // noise), so they are NOT rejections.
        const rejectedSpans = droppedSpanCount + ingestionFailureCount;
        return {
          rejectedSpans,
          errorMessage: errors.join("; "),
        };
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
    otelSpanRef?: import("@opentelemetry/api").Span;
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

      await this.deps.recordSpan({
        tenantId,
        span,
        resource,
        instrumentationScope,
        piiRedactionLevel,
        occurredAt: Date.now(),
      });

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
        error: error instanceof Error ? error.message : String(error),
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
    otelSpanRef: import("@opentelemetry/api").Span;
  }): Promise<SpanIngestionResult> {
    const spanParseResult = spanSchema.safeParse(otelSpan);
    if (!spanParseResult.success) {
      this.logger.warn(
        { result: spanParseResult, tenantId },
        "Error parsing OTLP span, dropping",
      );
    }
    if (!spanParseResult.data) {
      return {
        status: "dropped",
        error: `span validation failed: ${spanParseResult.error?.message ?? "unknown"}`,
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
        error: "span start time is more than 31 days in the past",
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
