import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { OtlpSpan } from "@langwatch/trace-contract";
import { TraceSpanTokenEstimation } from "../app/trace.infrastructure.ts";
import type { TraceTokenCounter } from "../app/trace.infrastructure.ts";
import { OtlpSpanTokenEstimationService } from "./span/span-token-estimation.service.ts";

/**
 * Renames the estimator onto the narrow port `RecordSpanCommand` names.
 *
 * The service is not a subclass of the port and must not become one: it takes a
 * named-argument object and the port takes positional arguments, and the port
 * is one of four sibling preparation steps that must stay interchangeable.
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
