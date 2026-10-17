import type { OtlpInstrumentationScope, OtlpSpan } from "@langwatch/otlp/trace-request";

import type {
  TraceSpanDedupRepository,
  UsageRecordRef,
} from "../../../repositories/trace-span-dedup.repository.ts";
import { usageCountingOf, withUsageCountedElsewhere } from "../rules/trace-request-usage.rules.ts";

/**
 * One billed request can reach the door as two spans (the Claude SDK's and the Claude API's).
 * The first to claim the request's usage record counts it; a later one is marked counted
 * elsewhere. A claim the store cannot answer counts the span, as the span claim does.
 */
export class TraceRequestUsageService {
  static create({ dedup }: { dedup: TraceSpanDedupRepository }): TraceRequestUsageService {
    return new TraceRequestUsageService(dedup);
  }

  private constructor(private readonly dedup: TraceSpanDedupRepository) {}

  async claim(input: {
    tenantId: string;
    span: OtlpSpan;
    instrumentationScope: OtlpInstrumentationScope | null;
  }): Promise<{ span: OtlpSpan; acquired: UsageRecordRef | null }> {
    const counting = usageCountingOf({
      span: input.span,
      scopeName: input.instrumentationScope?.name,
    });
    if (counting.kind === "per-span") {
      return { span: input.span, acquired: null };
    }

    const record: UsageRecordRef = {
      tenantId: input.tenantId,
      recordId: counting.recordId,
      spanId: input.span.spanId,
    };
    const claim = await this.dedup.claimUsageRecord(record);
    if (claim.outcome === "held") {
      return { span: withUsageCountedElsewhere(input.span), acquired: null };
    }

    return { span: input.span, acquired: claim.outcome === "acquired" ? record : null };
  }

  async release({ record }: { record: UsageRecordRef }): Promise<void> {
    await this.dedup.releaseUsageRecord(record);
  }
}
