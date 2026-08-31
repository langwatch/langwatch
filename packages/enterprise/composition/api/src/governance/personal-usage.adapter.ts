// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PersonalUsageWindow as PortablePersonalUsageWindow } from "@langwatch/enterprise-governance-contract";
import type {
  PersonalUsageBreakdown,
  PersonalUsageBucket,
} from "@langwatch/enterprise-governance-contract";
import { PersonalUsageReaderPort } from "@langwatch/enterprise-governance-server";
import type {
  AppPersonalUsageReadAdapter,
  PersonalUsageWindow,
} from "./personal-usage.clickhouse.repository";

type PersonalUsageSummaryRow = {
  totalCost: number;
  billedCost: number;
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
};

type PersonalUsageTopModelRow = { model: string; requests: number };

type IngestionPrincipalSummaryRow = {
  totalCost: number;
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
  topModel: { name: string; requests: number } | null;
};

export class AppPersonalUsageReader extends PersonalUsageReaderPort {
  private constructor(private readonly repository: AppPersonalUsageReadAdapter) {
    super();
  }

  static create(repository: AppPersonalUsageReadAdapter): AppPersonalUsageReader {
    return new AppPersonalUsageReader(repository);
  }

  findSummary(input: {
    tenantId: string;
    window: PortablePersonalUsageWindow;
  }): Promise<PersonalUsageSummaryRow> {
    return this.repository.findSummary(this.toAppInput(input));
  }

  tryFindTopModel(input: {
    tenantId: string;
    window: PortablePersonalUsageWindow;
  }): Promise<PersonalUsageTopModelRow | null> {
    return this.repository.findTopModel(this.toAppInput(input));
  }

  findDailyBuckets(input: {
    tenantId: string;
    window: PortablePersonalUsageWindow;
  }): Promise<PersonalUsageBucket[]> {
    return this.repository.findDailyBuckets(this.toAppInput(input));
  }

  findModelBreakdown(input: {
    tenantId: string;
    window: PortablePersonalUsageWindow;
    limit: number;
  }): Promise<PersonalUsageBreakdown[]> {
    return this.repository.findModelBreakdown({
      ...this.toAppInput(input),
      limit: input.limit,
    });
  }

  tryFindIngestionPrincipalSummary(input: {
    tenantId: string;
    userId: string;
    window: PortablePersonalUsageWindow;
  }): Promise<IngestionPrincipalSummaryRow | null> {
    return this.repository.findIngestionPrincipalSummary(this.toAppPrincipalInput(input));
  }

  findIngestionPrincipalBuckets(input: {
    tenantId: string;
    userId: string;
    window: PortablePersonalUsageWindow;
  }): Promise<PersonalUsageBucket[]> {
    return this.repository.findIngestionPrincipalBuckets(this.toAppPrincipalInput(input));
  }

  findIngestionPrincipalBreakdown(input: {
    tenantId: string;
    userId: string;
    window: PortablePersonalUsageWindow;
  }): Promise<PersonalUsageBreakdown[]> {
    return this.repository.findIngestionPrincipalBreakdown(this.toAppPrincipalInput(input));
  }

  private toAppInput(input: { tenantId: string; window: PortablePersonalUsageWindow }): {
    tenantId: string;
    window: PersonalUsageWindow;
  } {
    return {
      tenantId: input.tenantId,
      window: {
        start: new Date(input.window.startMs),
        end: new Date(input.window.endMs),
      },
    };
  }

  private toAppPrincipalInput(input: {
    tenantId: string;
    userId: string;
    window: PortablePersonalUsageWindow;
  }): { tenantId: string; userId: string; window: PersonalUsageWindow } {
    return { ...this.toAppInput(input), userId: input.userId };
  }
}
