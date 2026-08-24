import {
  CanonicalCostExtractorService,
  GovernanceSetupActivityPort,
  PostgresGovernanceAdapter,
  PostgresGovernanceOcsfExportAdapter,
  PostgresGovernanceSetupStateAdapter,
  PostgresIngestionTemplateAdapter,
  type CanonicalCostEvent,
  type GovernanceDatabase,
  type GovernanceOcsfEventsReaderPort,
  type OtlpLogsRequest,
} from "@langwatch/enterprise-governance-server";
import type {
  GovernanceOttlGateway,
  GovernanceOcsfExportService,
  GovernancePolicyService,
  GovernanceSetupStateService,
  IngestionTemplatesService,
} from "@langwatch/enterprise-governance-contract";
import { AppGovernanceOttlGateway } from "./governance/ottl-gateway.client";

export type { CanonicalCostEvent };

type GovernanceSetupActivity = {
  hasRecentActivity(input: {
    tenantId: string;
    sinceMs: number;
  }): Promise<boolean>;
};

class AppGovernanceSetupActivityPort extends GovernanceSetupActivityPort {
  private constructor(private readonly activity: GovernanceSetupActivity) {
    super();
  }

  static create(
    activity: GovernanceSetupActivity,
  ): AppGovernanceSetupActivityPort {
    return new AppGovernanceSetupActivityPort(activity);
  }

  hasRecentActivity(
    input: Parameters<GovernanceSetupActivityPort["hasRecentActivity"]>[0],
  ): Promise<boolean> {
    return this.activity.hasRecentActivity(input);
  }
}

export class AppGovernanceRuntime {
  private constructor(
    readonly canonicalCostExtractor: CanonicalCostExtractorService,
    private readonly policy: GovernancePolicyService,
    readonly ingestionTemplates: IngestionTemplatesService,
    readonly setupState: GovernanceSetupStateService,
    readonly ocsfExport: GovernanceOcsfExportService,
    readonly ottlGateway: GovernanceOttlGateway,
  ) {}

  static create(
    database: GovernanceDatabase,
    options?: {
      setupActivity?: GovernanceSetupActivity;
      ocsfEvents?: GovernanceOcsfEventsReaderPort;
      ottl?: {
        baseUrl?: string | null;
        secret?: string | null;
        request?: typeof fetch;
        now?: () => number;
      };
    },
  ): AppGovernanceRuntime {
    return new AppGovernanceRuntime(
      CanonicalCostExtractorService.create(),
      PostgresGovernanceAdapter.create({ database }).build().policy,
      PostgresIngestionTemplateAdapter.create({ database }).build(),
      PostgresGovernanceSetupStateAdapter.create({
        database,
        activity: options?.setupActivity
          ? AppGovernanceSetupActivityPort.create(options.setupActivity)
          : undefined,
      }).build(),
      PostgresGovernanceOcsfExportAdapter.create({
        database,
        events: options?.ocsfEvents,
      }).build(),
      AppGovernanceOttlGateway.create(options?.ottl ?? {}),
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
