import {
  CanonicalCostExtractorService,
  PostgresGovernanceAdapter,
  type CanonicalCostEvent,
  type GovernanceDatabase,
  type OtlpLogsRequest,
} from "@langwatch/enterprise-governance-server";
import type { GovernancePolicyService } from "@langwatch/enterprise-governance-contract";

export type { CanonicalCostEvent };

export class AppGovernanceRuntime {
  private constructor(
    private readonly canonicalCostExtractor: CanonicalCostExtractorService,
    private readonly policy: GovernancePolicyService,
  ) {}

  static create(database: GovernanceDatabase): AppGovernanceRuntime {
    return new AppGovernanceRuntime(
      CanonicalCostExtractorService.create(),
      PostgresGovernanceAdapter.create({ database }).build().policy,
    );
  }

  extractCanonicalCostEvents(request: OtlpLogsRequest): CanonicalCostEvent[] {
    return this.canonicalCostExtractor.extract(request);
  }

  resolveSourceNonBillable(input: {
    organizationId: string;
    sourceType: string;
  }): Promise<boolean> {
    return this.policy.resolveSourceNonBillable(input);
  }
}
