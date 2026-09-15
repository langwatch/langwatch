import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { OtlpSpan } from "@langwatch/trace-contract";
import { type TraceSpanTokenEstimation } from "../app/trace.members.ts";
import type { TraceTokenCounter } from "../app/trace.members.ts";
import { OtlpSpanTokenEstimationService } from "./span/span-token-estimation.service.ts";

/**
 * Renames the estimator onto the narrow port `EventingRecordSpanAdapter`
 * names. Not a subclass of the port: named arguments vs. positional, one
 * of four interchangeable sibling preparation steps.
 */
export class TraceSpanTokenEstimationAdapter implements TraceSpanTokenEstimation {
  static create(options: {
    tokenizer: TraceTokenCounter;
    featureFlags: FeatureFlagApi;
  }): TraceSpanTokenEstimationAdapter {
    return new TraceSpanTokenEstimationAdapter(OtlpSpanTokenEstimationService.create(options));
  }

  private constructor(private readonly service: OtlpSpanTokenEstimationService) {
  }

  async estimate(span: OtlpSpan, tenantId: string): Promise<void> {
    await this.service.estimateSpanTokens({ span, tenantId });
  }
}
