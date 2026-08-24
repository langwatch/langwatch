import {
  CanonicalCostExtractorService,
  PostgresGovernanceAdapter,
  PostgresIngestionTemplateAdapter,
  type CanonicalCostEvent,
  type GovernanceDatabase,
  type OtlpLogsRequest,
} from "@langwatch/enterprise-governance-server";
import type {
  GovernancePolicyService,
  IngestionTemplatesService,
} from "@langwatch/enterprise-governance-contract";

export type { CanonicalCostEvent };

export class AppGovernanceRuntime {
  private constructor(
    private readonly canonicalCostExtractor: CanonicalCostExtractorService,
    private readonly policy: GovernancePolicyService,
    readonly ingestionTemplates: IngestionTemplatesService,
  ) {}

  static create(database: GovernanceDatabase): AppGovernanceRuntime {
    return new AppGovernanceRuntime(
      CanonicalCostExtractorService.create(),
      PostgresGovernanceAdapter.create({ database }).build().policy,
      PostgresIngestionTemplateAdapter.create({ database }).build(),
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
