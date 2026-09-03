import type {
  PersonalUsageBreakdown,
  PersonalUsageBucket,
  PersonalUsageWindow,
} from "@langwatch/enterprise-governance-contract";

export type PersonalUsageSummaryRow = {
  totalCost: number;
  billedCost: number;
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
};

export type PersonalUsageTopModelRow = {
  model: string;
  requests: number;
};

export type IngestionPrincipalSummaryRow = {
  totalCost: number;
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
  topModel: { name: string; requests: number } | null;
};

export abstract class PersonalUsageReaderPort {
  abstract findSummary(input: {
    tenantId: string;
    window: PersonalUsageWindow;
  }): Promise<PersonalUsageSummaryRow>;

  abstract tryFindTopModel(input: {
    tenantId: string;
    window: PersonalUsageWindow;
  }): Promise<PersonalUsageTopModelRow | null>;

  abstract findDailyBuckets(input: {
    tenantId: string;
    window: PersonalUsageWindow;
  }): Promise<PersonalUsageBucket[]>;

  abstract findModelBreakdown(input: {
    tenantId: string;
    window: PersonalUsageWindow;
    limit: number;
  }): Promise<PersonalUsageBreakdown[]>;

  abstract tryFindIngestionPrincipalSummary(input: {
    tenantId: string;
    userId: string;
    window: PersonalUsageWindow;
  }): Promise<IngestionPrincipalSummaryRow | null>;

  abstract findIngestionPrincipalBuckets(input: {
    tenantId: string;
    userId: string;
    window: PersonalUsageWindow;
  }): Promise<PersonalUsageBucket[]>;

  abstract findIngestionPrincipalBreakdown(input: {
    tenantId: string;
    userId: string;
    window: PersonalUsageWindow;
  }): Promise<PersonalUsageBreakdown[]>;
}
