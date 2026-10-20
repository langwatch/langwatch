import { createLogger } from "@langwatch/observability";
import type {
  OtlpInstrumentationScope,
  OtlpResource,
  OtlpSpan,
} from "@langwatch/otlp/trace-request";
import { nowInstant } from "@langwatch/time";
import type { PIIRedactionLevel, RecordSpanCommandData } from "@langwatch/trace-contract";
import type { Span as OtelSpan } from "@opentelemetry/api";

import type {
  SpanDedupClaim,
  SpanDedupRef,
  TraceSpanDedupRepository,
  UsageRecordRef,
} from "../../../repositories/trace-span-dedup.repository.ts";
import { TraceRequestUsageService } from "./trace-request-usage.service.ts";

export type SpanIngestionStatus = "collected" | "dropped" | "deduped" | "failed" | "filtered";

export type SpanIngestionResult = {
  status: SpanIngestionStatus;
  error?: string;
};

/** One already-normalized span on its way to the Trace command pipeline. */
export type NormalizedSpanInput = {
  tenantId: string;
  span: OtlpSpan;
  resource: OtlpResource | null;
  instrumentationScope: OtlpInstrumentationScope | null;
  piiRedactionLevel: PIIRedactionLevel;
  otelSpanRef?: OtelSpan;
};

/** A span's command, and the usage record it claimed, released if the span fails. */
type PreparedSpan = { data: RecordSpanCommandData; usageRecord: UsageRecordRef | null };

/** Spans claimed per dedup round trip: few enough that each is recorded well inside its claim. */
const DEDUP_BATCH_SIZE = 100;

/** The store gave no answer for this span: ingest it, as an unreachable store would. */
const UNANSWERED_CLAIM: SpanDedupClaim = { outcome: "unknown" };

/** One span's hand-off answer from `recordSpans`, at its input position. */
export type RecordSpanOutcome =
  | Readonly<{ status: "recorded" }>
  | Readonly<{ status: "failed"; error: unknown }>;

/** The pipeline answered fewer spans than it was handed: the missing ones did not land. */
const NO_HAND_OFF_ANSWER: RecordSpanOutcome = {
  status: "failed",
  error: new Error("The trace pipeline gave no answer for this span"),
};

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
 * The span-collection half of ingestion: dedup, payload prep, command
 * handoff. Split from the ingestion service at the worker conversion,
 * since its coding-agent span filter is unreachable from a worker's path.
 */
export class TraceSpanCollectionService {
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
