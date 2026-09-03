import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type { OtlpSpan } from "@langwatch/trace-contract";
import { TraceSpanTokenEstimationPort } from "../ports/trace-span-preparation.port";
import type { TraceTokenCounterPort } from "../ports/trace-token-counter.port";
import { OtlpSpanTokenEstimationService } from "../services/span-token-estimation.service";

/**
 * Renames the estimator onto the narrow port `RecordSpanCommand` names.
 *
 * The service is not a subclass of the port and must not become one: it takes a
 * named-argument object and the port takes positional arguments, and the port
 * is one of four sibling preparation steps that must stay interchangeable.
 */
export class TraceSpanTokenEstimationAdapter extends TraceSpanTokenEstimationPort {
  static create(options: {
    tokenizer: TraceTokenCounterPort;
    featureFlags: FeatureFlagService;
  }): TraceSpanTokenEstimationAdapter {
    return new TraceSpanTokenEstimationAdapter(OtlpSpanTokenEstimationService.create(options));
  }

  private constructor(private readonly service: OtlpSpanTokenEstimationService) {
    super();
  }

  async estimate(span: OtlpSpan, tenantId: string): Promise<void> {
    await this.service.estimateSpanTokens({ span, tenantId });
  }
}
