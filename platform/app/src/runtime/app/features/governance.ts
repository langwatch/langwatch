import {
  CanonicalCostExtractorService,
  type CanonicalCostEvent,
  type OtlpLogsRequest,
} from "@langwatch/enterprise-governance-server";

export type { CanonicalCostEvent };

export class AppGovernanceRuntime {
  private constructor(
    private readonly canonicalCostExtractor: CanonicalCostExtractorService,
  ) {}

  static create(): AppGovernanceRuntime {
    return new AppGovernanceRuntime(CanonicalCostExtractorService.create());
  }

  extractCanonicalCostEvents(request: OtlpLogsRequest): CanonicalCostEvent[] {
    return this.canonicalCostExtractor.extract(request);
  }
}
