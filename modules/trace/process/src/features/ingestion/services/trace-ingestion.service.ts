import type { shouldFilterCodingAgentSpan } from "@langwatch/coding-agent-contract";
import { createLogger } from "@langwatch/observability";
import {
  instrumentationScopeSchema,
  type OtlpInstrumentationScope,
  type OtlpResource,
  type OtlpSpan,
  resourceSchema,
  spanSchema,
} from "@langwatch/otlp/trace-request";
import { nowInstant } from "@langwatch/time";
import {
  type PIIRedactionLevel,
  type RecordSpanCommandData,
  SPAN_BACKFILL_MAX_PAST_DAYS,
  SPAN_MAX_PAST_MS,
  storableSpanTimesOf,
  type UnstorableSpanTime,
} from "@langwatch/trace-contract";
import { normalizeOtlpId } from "@langwatch/trace-contract/otlp-decoding";
import { SpanKind as ApiSpanKind, type Span as OtelSpan } from "@opentelemetry/api";
import type { IExportTraceServiceRequest } from "@opentelemetry/otlp-transformer";
import { getLangWatchTracer } from "langwatch";

import type {
  SpanDedupClaim,
  SpanDedupRef,
  TraceSpanDedupRepository,
  UsageRecordRef,
} from "../../../repositories/trace-span-dedup.repository.ts";
import {
  codexHelperThreadMarkersOf,
  stampCodexHelperThread,
  type ScopedSpans,
} from "../../claude-code/rules/codex-helper-thread.rules.ts";
import { TraceIngestionMetricsService } from "./trace-ingestion-metrics.service.ts";
import { TraceRequestUsageService } from "./trace-request-usage.service.ts";

type SpanIngestionStatus = "collected" | "dropped" | "deduped" | "failed" | "filtered";

type SpanIngestionResult = {
  status: SpanIngestionStatus;
  error?: string;
};

/** One already-normalized span on its way to the Trace command pipeline. */
type NormalizedSpanInput = {
  tenantId: string;
  span: OtlpSpan;
  resource: OtlpResource | null;
  instrumentationScope: OtlpInstrumentationScope | null;
  piiRedactionLevel: PIIRedactionLevel;
  otelSpanRef?: OtelSpan;
};

/** A span's command, and the usage record it claimed, released if the span fails. */
type PreparedSpan = { data: RecordSpanCommandData; usageRecord: UsageRecordRef | null };

/** A raw span's admission: decided at the door, or admitted for collection. */
type SpanAdmission =
  | Readonly<{ result: SpanIngestionResult }>
  | Readonly<{ ingest: NormalizedSpanInput }>;

/** Spans claimed per dedup round trip: few enough that each is recorded well inside its claim. */
const DEDUP_BATCH_SIZE = 100;

/** The store gave no answer for this span: ingest it, as an unreachable store would. */
const UNANSWERED_CLAIM: SpanDedupClaim = { outcome: "unknown" };

/** The pipeline answered fewer spans than it was handed: the missing ones did not land. */
const NO_HAND_OFF_ANSWER: RecordSpanOutcome = {
  status: "failed",
  error: new Error("The trace pipeline gave no answer for this span"),
};

type TraceRequestCollectionResult = {
  rejectedSpans: number;
  /**
   * The dispatch failures within `rejectedSpans`: transient, so a durable-cursor caller retries.
   */
  ingestionFailures: number;
  /** Only the dispatch failures' messages, without the drop reasons `errorMessage` carries. */
  ingestionFailureMessage: string;
  errorMessage: string;
};

/** One span's hand-off answer from `recordSpans`, at its input position. */
export type RecordSpanOutcome =
  | Readonly<{ status: "recorded" }>
  | Readonly<{ status: "failed"; error: unknown }>;

/** The Trace pipeline's one named command handoff. */
export abstract class TraceIngressCommand {
  abstract recordSpan(data: RecordSpanCommandData): Promise<void>;
  /** Hands each span off as `recordSpan` would, in bounded batches; one answer per span. */
  abstract recordSpans(
    data: readonly RecordSpanCommandData[],
  ): Promise<readonly RecordSpanOutcome[]>;
}

/** Optional edge/blob preparation, composed by the application when enabled. */
export abstract class TraceIngressPayload {
  abstract prepare(data: RecordSpanCommandData): Promise<RecordSpanCommandData>;
}

/**
 * The outcome of every span in one export request. Only `dropped` and
 * `failed` are a rejection — `filtered`/`deduped` are declined on purpose —
 * and the transport turns `rejectedSpans` into the sender's HTTP answer.
 */
class SpanIngestionTally {
  private readonly counts: Record<SpanIngestionStatus, number> = {
    collected: 0,
    dropped: 0,
    deduped: 0,
    failed: 0,
    filtered: 0,
  };
  private readonly errors: string[] = [];
  private readonly failureErrors: string[] = [];

  record(result: SpanIngestionResult): void {
    this.counts[result.status]++;
    if (result.status === "failed" && result.error) {
      this.failureErrors.push(result.error);
    }
    if (result.error) {
      this.errors.push(result.error);
    }
  }

  describeOn(otelSpanRef: OtelSpan): void {
    otelSpanRef.setAttribute("spans.ingestion.successes", this.counts.collected);
    otelSpanRef.setAttribute("spans.ingestion.failures", this.counts.failed);
    otelSpanRef.setAttribute("spans.ingestion.drops", this.counts.dropped);
    otelSpanRef.setAttribute("spans.ingestion.deduped", this.counts.deduped);
    otelSpanRef.setAttribute("spans.ingestion.filtered", this.counts.filtered);
  }

  outcomes(): Readonly<Record<SpanIngestionStatus, number>> {
    return this.counts;
  }

  collectionResult(): TraceRequestCollectionResult {
    return {
      rejectedSpans: this.counts.dropped + this.counts.failed,
      ingestionFailures: this.counts.failed,
      ingestionFailureMessage: this.failureErrors.join("; "),
      errorMessage: this.errors.join("; "),
    };
  }
}

/** The ingest path's coding-agent span filter: the contract's pure rule, swappable in tests. */
export type CodingAgentIngestFilter = { shouldFilterSpan: typeof shouldFilterCodingAgentSpan };

/** What the producer is told, naming the field it has to fix. */
function unstorableSpanTimeMessage({ field }: UnstorableSpanTime): string {
  return field === "startTimeUnixMs"
    ? "span start time is not a valid timestamp"
    : "span end time is not a valid timestamp";
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** A backfill's reach in whole days, never short of the door's nor past the ceiling. */
function maxPastMsOf(backfillMaxPastDays: number): number {
  const days = Math.min(Math.max(Math.floor(backfillMaxPastDays), 0), SPAN_BACKFILL_MAX_PAST_DAYS);
  return Math.max(days * DAY_MS, SPAN_MAX_PAST_MS);
}

/**
 * Process-wide Trace receiver. Transport keeps auth and HTTP response mapping;
 * this service owns raw OTLP trace traversal, validation, filtering, dedup and
 * the handoff to the Trace command pipeline.
 */
export class TraceIngestionService {
  private readonly tracer = getLangWatchTracer("langwatch.trace-processing.span-ingestion");
  private readonly logger = createLogger("langwatch:trace-processing:span-ingestion");
  private readonly outcomeMetrics = TraceIngestionMetricsService.create();

  private constructor(
    private readonly codingAgentFilter: CodingAgentIngestFilter,
    private readonly codingAgentSpanFilterEnabled: boolean,
    private readonly collection: TraceSpanCollectionService,
  ) {}

  static create(options: {
    codingAgentFilter: CodingAgentIngestFilter;
    codingAgentSpanFilterEnabled: boolean;
    dedup: TraceSpanDedupRepository;
    commands: TraceIngressCommand;
    payloads?: TraceIngressPayload;
  }): TraceIngestionService {
    return new TraceIngestionService(
      options.codingAgentFilter,
      options.codingAgentSpanFilterEnabled,
      TraceSpanCollectionService.create({
        dedup: options.dedup,
        commands: options.commands,
        ...(options.payloads ? { payloads: options.payloads } : {}),
      }),
    );
  }

  handleOtlpTraceRequest(
    tenantId: string,
    traceRequest: IExportTraceServiceRequest,
    piiRedactionLevel: PIIRedactionLevel,
  ): Promise<TraceRequestCollectionResult> {
    return this.collectOtlpTraces(tenantId, traceRequest, {
      piiRedactionLevel,
      maxPastMs: SPAN_MAX_PAST_MS,
    });
  }

  /** An in-process backfill: the same receiver, reaching `backfillMaxPastDays` back (Q1 (a)). */
  handleOtlpTraceBackfill(
    input: Readonly<{
      tenantId: string;
      traceRequest: IExportTraceServiceRequest;
      piiRedactionLevel: PIIRedactionLevel;
      backfillMaxPastDays: number;
    }>,
  ): Promise<TraceRequestCollectionResult> {
    return this.collectOtlpTraces(input.tenantId, input.traceRequest, {
      piiRedactionLevel: input.piiRedactionLevel,
      maxPastMs: maxPastMsOf(input.backfillMaxPastDays),
    });
  }

  private async collectOtlpTraces(
    tenantId: string,
    traceRequest: IExportTraceServiceRequest,
    {
      piiRedactionLevel,
      maxPastMs,
    }: Readonly<{ piiRedactionLevel: PIIRedactionLevel; maxPastMs: number }>,
  ): Promise<TraceRequestCollectionResult> {
    return this.tracer.withActiveSpan(
      "TraceIngestionService.handleOtlpTraceRequest",
      {
        kind: ApiSpanKind.PRODUCER,
        attributes: {
          "tenant.id": tenantId,
          trace_request_count: traceRequest.resourceSpans?.length ?? 0,
        },
      },
      async (otelSpanRef) => {
        const tally = new SpanIngestionTally();
        // A codex helper's request span names its thread only through a child in the same
        // export, so the join runs over the whole request before any span is processed.
        const helperThreads = codexHelperThreadMarkersOf({
          scopes: scopedSpansOf(traceRequest),
        });

        const admissions = this.admitRequestSpans({
          tenantId,
          traceRequest,
          piiRedactionLevel,
          otelSpanRef,
          helperThreads,
          maxPastMs,
        });
        // Admitted spans are collected together, so their dedup claims share round trips.
        const collected = await this.collection.ingestNormalizedSpans(
          admissions.flatMap((admission) => ("ingest" in admission ? [admission.ingest] : [])),
        );
        recordInRequestOrder({ tally, admissions, collected });

        tally.describeOn(otelSpanRef);
        this.outcomeMetrics.record(tally.outcomes());

        return tally.collectionResult();
      },
    );
  }

  /** Every span of the request admitted or decided at the door, in request order. */
  private admitRequestSpans({
    tenantId,
    traceRequest,
    piiRedactionLevel,
    otelSpanRef,
    helperThreads,
    maxPastMs,
  }: {
    tenantId: string;
    traceRequest: IExportTraceServiceRequest;
    piiRedactionLevel: PIIRedactionLevel;
    otelSpanRef: OtelSpan;
    helperThreads: Map<string, string>;
    maxPastMs: number;
  }): SpanAdmission[] {
    const admissions: SpanAdmission[] = [];
    for (const resourceSpan of traceRequest.resourceSpans ?? []) {
      const resource = this.parseResource(resourceSpan?.resource, tenantId);

      for (const scopeSpan of resourceSpan?.scopeSpans ?? []) {
        const scope = this.parseScope(scopeSpan?.scope, tenantId);

        for (const candidate of scopeSpan?.spans ?? []) {
          admissions.push(
            this.admitSpan({
              tenantId,
              otelSpan: candidate,
              resource,
              scope,
              piiRedactionLevel,
              otelSpanRef,
              helperThreads,
              maxPastMs,
            }),
          );
        }
      }
    }
    return admissions;
  }

  /**
   * A resource or scope we cannot read is logged and treated as absent — the
   * spans underneath it are still the sender's data, and dropping a whole
   * batch over a malformed envelope loses more than it protects.
   */
  private parseResource(candidate: unknown, tenantId: string): OtlpResource | null {
    const result = resourceSchema.safeParse(candidate);
    if (!result.success) {
      this.logger.error({ result, tenantId }, "Error parsing OTLP resource");
    }

    return result.data ?? null;
  }

  private parseScope(candidate: unknown, tenantId: string): OtlpInstrumentationScope | null {
    const result = instrumentationScopeSchema.safeParse(candidate);
    if (!result.success) {
      this.logger.error({ result, tenantId }, "Error parsing OTLP scope");
    }

    return result.data ?? null;
  }

  /**
   * One already-normalized span, collected. Kept on this class because the
   * OTLP request path and the REST tracked-event path both reach it by name;
   * the work itself belongs to {@link TraceSpanCollectionService}.
   */
  ingestNormalizedSpan(input: NormalizedSpanInput): Promise<SpanIngestionResult> {
    return this.collection.ingestNormalizedSpan(input);
  }

  /** Validates and filters one raw span: a final result, or the normalized span to collect. */
  private admitSpan(input: {
    tenantId: string;
    otelSpan: unknown;
    resource: OtlpResource | null;
    scope: OtlpInstrumentationScope | null;
    piiRedactionLevel: PIIRedactionLevel;
    otelSpanRef: OtelSpan;
    /** Codex helper threads by request span id; absent, nothing is stamped. */
    helperThreads?: Map<string, string>;
    maxPastMs: number;
  }): SpanAdmission {
    const spanParseResult = spanSchema.safeParse(input.otelSpan);
    if (!spanParseResult.success) {
      this.logger.warn(
        { result: spanParseResult, tenantId: input.tenantId },
        "Error parsing OTLP span, dropping",
      );

      return {
        result: {
          status: "dropped",
          error: `span validation failed: ${spanParseResult.error.message}`,
        },
      };
    }

    // A time storage cannot hold is refused at the door: minted into a record id
    // after the append it throws permanently on a retrying lane. One span's problem.
    const decoded = storableSpanTimesOf(spanParseResult.data);
    if ("unstorable" in decoded) {
      return {
        result: { status: "dropped", error: unstorableSpanTimeMessage(decoded.unstorable) },
      };
    }
    const { startTimeUnixMs } = decoded.times;

    if (startTimeUnixMs < nowInstant().epochMilliseconds - input.maxPastMs) {
      const days = Math.round(input.maxPastMs / DAY_MS);
      const error = `span start time is more than ${days} days in the past`;
      return { result: { status: "dropped", error } };
    }

    // The stamp is the admission: it is applied before the filter reads the span.
    const helperThreadId = input.helperThreads?.get(normalizeOtlpId(spanParseResult.data.spanId));
    const span =
      helperThreadId === undefined
        ? spanParseResult.data
        : stampCodexHelperThread({ span: spanParseResult.data, threadId: helperThreadId });

    const isFilteredCodingAgentSpan =
      this.codingAgentSpanFilterEnabled &&
      this.codingAgentFilter.shouldFilterSpan({
        scopeName: input.scope?.name,
        spanName: span.name,
        attributeKeys: span.attributes.map((attribute) => attribute.key),
      });
    if (isFilteredCodingAgentSpan) {
      return { result: { status: "filtered" } };
    }

    return {
      ingest: {
        tenantId: input.tenantId,
        span: this.withHexIds(span),
        resource: input.resource,
        instrumentationScope: input.scope,
        piiRedactionLevel: input.piiRedactionLevel,
        otelSpanRef: input.otelSpanRef,
      },
    };
  }

  /**
   * Ids arrive as raw bytes over protobuf and as hex over JSON; dedup and
   * the pipeline want one of them.
   */
  private withHexIds(span: OtlpSpan): OtlpSpan {
    const hex = normalizeOtlpId;

    return {
      ...span,
      traceId: hex(span.traceId),
      spanId: hex(span.spanId),
      parentSpanId: span.parentSpanId ? hex(span.parentSpanId) : span.parentSpanId,
      links: span.links.map((link) => ({
        ...link,
        traceId: hex(link.traceId),
        spanId: hex(link.spanId),
      })),
    };
  }
}

/**
 * The span-collection half of ingestion: dedup, payload prep, command
 * handoff. Split from {@link TraceIngestionService} at the worker conversion,
 * since its coding-agent span filter is unreachable from a worker's path.
 */
class TraceSpanCollectionService {
  private readonly logger = createLogger("langwatch:trace-processing:span-collection");
  private readonly usage: TraceRequestUsageService;

  private constructor(
    private readonly options: {
      dedup: TraceSpanDedupRepository;
      commands: TraceIngressCommand;
      payloads?: TraceIngressPayload;
    },
  ) {
    this.usage = TraceRequestUsageService.create({ dedup: options.dedup });
  }

  static create(options: {
    dedup: TraceSpanDedupRepository;
    commands: TraceIngressCommand;
    payloads?: TraceIngressPayload;
  }): TraceSpanCollectionService {
    return new TraceSpanCollectionService(options);
  }

  async ingestNormalizedSpan(input: NormalizedSpanInput): Promise<SpanIngestionResult> {
    const ref = spanDedupRefOf(input);
    const [claim = UNANSWERED_CLAIM] = await this.options.dedup.claimProcessing([ref]);
    const result = await this.collectClaimed({ input, claim });
    if (result.status === "collected") await this.options.dedup.confirmProcessed([ref]);
    return result;
  }

  /** Spans in order, claimed and confirmed per batch rather than per span. */
  async ingestNormalizedSpans(
    inputs: readonly NormalizedSpanInput[],
  ): Promise<SpanIngestionResult[]> {
    const results: SpanIngestionResult[] = [];
    for (let start = 0; start < inputs.length; start += DEDUP_BATCH_SIZE) {
      results.push(...(await this.collectBatch(inputs.slice(start, start + DEDUP_BATCH_SIZE))));
    }
    return results;
  }

  /**
   * One claim round trip, the claimed spans prepared one by one and handed off together, one
   * confirmation for those the pipeline took. A failed span releases its claim, so a resend
   * reaches the pipeline under the same identity (specs/span-admission-batch-hand-off.feature).
   */
  private async collectBatch(
    inputs: readonly NormalizedSpanInput[],
  ): Promise<SpanIngestionResult[]> {
    const claims = await this.options.dedup.claimProcessing(inputs.map(spanDedupRefOf));
    const results: SpanIngestionResult[] = [];
    const ready: ({ index: number; input: NormalizedSpanInput } & PreparedSpan)[] = [];
    const failures: Promise<void>[] = [];
    for (const [index, input] of inputs.entries()) {
      const claim = claims[index] ?? UNANSWERED_CLAIM;
      if (claim.outcome === "held") {
        results[index] = { status: "deduped" };
        continue;
      }
      try {
        ready.push({ index, input, ...(await this.prepareCommand(input)) });
      } catch (error) {
        results[index] = this.failedSpan({ input, error });
        if (claim.outcome === "acquired") failures.push(this.releaseClaim(input));
      }
    }

    const outcomes = await this.handOff(ready.map(({ data }) => data));
    const recorded: SpanDedupRef[] = [];
    for (const [offset, { index, input, usageRecord }] of ready.entries()) {
      const outcome = outcomes[offset] ?? NO_HAND_OFF_ANSWER;
      if (outcome.status === "recorded") {
        results[index] = { status: "collected" };
        recorded.push(spanDedupRefOf(input));
        continue;
      }
      results[index] = this.failedSpan({ input, error: outcome.error });
      if (claims[index]?.outcome === "acquired") failures.push(this.releaseClaim(input));
      if (usageRecord) failures.push(this.usage.release({ record: usageRecord }));
    }
    await Promise.all(failures);
    await this.options.dedup.confirmProcessed(recorded);
    return results;
  }

  /** The prepared spans handed off in one call; a call that throws fails every one of them. */
  private async handOff(
    data: readonly RecordSpanCommandData[],
  ): Promise<readonly RecordSpanOutcome[]> {
    if (data.length === 0) return [];
    try {
      return await this.options.commands.recordSpans(data);
    } catch (error) {
      return data.map(() => ({ status: "failed", error }));
    }
  }

  /**
   * The command one span becomes: its usage record claimed, then the optional edge/blob
   * preparation. A preparation that throws releases the usage record it claimed.
   */
  private async prepareCommand(input: NormalizedSpanInput): Promise<PreparedSpan> {
    const usage = await this.usage.claim(input);
    const commandData: RecordSpanCommandData = {
      tenantId: input.tenantId,
      span: usage.span,
      resource: input.resource,
      instrumentationScope: input.instrumentationScope,
      piiRedactionLevel: input.piiRedactionLevel,
      occurredAt: nowInstant().epochMilliseconds,
    };
    try {
      const data = this.options.payloads
        ? await this.options.payloads.prepare(commandData)
        : commandData;
      return { data, usageRecord: usage.acquired };
    } catch (error) {
      if (usage.acquired) await this.usage.release({ record: usage.acquired });
      throw error;
    }
  }

  private async releaseClaim(input: NormalizedSpanInput): Promise<void> {
    await this.options.dedup.releaseOnFailure(spanDedupRefOf(input));
  }

  /** A span the pipeline did not take, noted on the request span and logged. */
  private failedSpan({
    input,
    error,
  }: {
    input: NormalizedSpanInput;
    error: unknown;
  }): SpanIngestionResult {
    input.otelSpanRef?.addEvent("span_ingestion_error", {
      "error.message": error instanceof Error ? error.message : String(error),
      "tenant.id": input.tenantId,
    });
    this.logger.error(
      { error, tenantId: input.tenantId, traceId: input.span.traceId, spanId: input.span.spanId },
      "Error dispatching span to the trace processing pipeline",
    );
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  private async collectClaimed({
    input,
    claim,
  }: {
    input: NormalizedSpanInput;
    claim: SpanDedupClaim;
  }): Promise<SpanIngestionResult> {
    if (claim.outcome === "held") {
      return { status: "deduped" };
    }
    let usageRecord: UsageRecordRef | null = null;
    try {
      const prepared = await this.prepareCommand(input);
      usageRecord = prepared.usageRecord;
      await this.options.commands.recordSpan(prepared.data);
      return { status: "collected" };
    } catch (error) {
      if (claim.outcome === "acquired") await this.releaseClaim(input);
      if (usageRecord) await this.usage.release({ record: usageRecord });
      return this.failedSpan({ input, error });
    }
  }
}

/** A span's dedup identity: its id within its trace and tenant. */
function spanDedupRefOf(input: NormalizedSpanInput): SpanDedupRef {
  return { tenantId: input.tenantId, traceId: input.span.traceId, spanId: input.span.spanId };
}

/** Tallies each span's outcome in request order; collected results follow the admitted spans. */
function recordInRequestOrder({
  tally,
  admissions,
  collected,
}: {
  tally: SpanIngestionTally;
  admissions: readonly SpanAdmission[];
  collected: readonly SpanIngestionResult[];
}): void {
  let next = 0;
  for (const admission of admissions) {
    const result = "ingest" in admission ? collected[next++] : admission.result;
    if (result) tally.record(result);
  }
}

/** Every scope entry of the request with its parsed spans, for the helper-thread join. */
function scopedSpansOf(traceRequest: IExportTraceServiceRequest): ScopedSpans[] {
  return (traceRequest.resourceSpans ?? []).flatMap((resourceSpan) =>
    (resourceSpan?.scopeSpans ?? []).map((scopeSpan) => ({
      scopeName: scopeSpan?.scope?.name,
      spans: (scopeSpan?.spans ?? []).flatMap((candidate) => {
        const parsed = spanSchema.safeParse(candidate);
        return parsed.success ? [parsed.data] : [];
      }),
    })),
  );
}
