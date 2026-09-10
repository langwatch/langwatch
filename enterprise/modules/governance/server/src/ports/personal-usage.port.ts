import type {
  PersonalUsageBreakdown,
  PersonalUsageBucket,
  PersonalUsageWindow,
  PersonalVirtualKey,
} from "@langwatch/enterprise-governance-contract";

/**
 * Folded in from the now-deleted personal-virtual-key.port.ts: the two files
 * both concern the personal-key/personal-usage domain, and the issuer port
 * alone was under the twenty-line fragment-file floor once its repository
 * sibling moved to repositories/directory/.
 */
export abstract class PersonalVirtualKeyIssuerPort {
  abstract issue(input: {
    organizationId: string;
    userId: string;
    personalProjectId: string;
    label: string;
    routingPolicyId: string | null;
  }): Promise<{ virtualKey: PersonalVirtualKey; secret: string }>;
  abstract revoke(input: {
    id: string;
    organizationId: string;
    actorUserId: string;
  }): Promise<PersonalVirtualKey>;
}

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
