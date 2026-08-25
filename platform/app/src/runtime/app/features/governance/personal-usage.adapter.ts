// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PersonalUsageWindow as PortablePersonalUsageWindow } from "@langwatch/enterprise-governance-contract";
import {
  DefaultGovernancePersonalUsageService,
  PersonalUsageReaderPort,
  type IngestionPrincipalSummaryRow,
  type PersonalUsageSummaryRow,
  type PersonalUsageTopModelRow,
} from "@langwatch/enterprise-governance-server";
import type {
  PersonalUsageClickHouseRepository,
  PersonalUsageWindow,
} from "./personal-usage.clickhouse.repository";

class AppPersonalUsageReader extends PersonalUsageReaderPort {
  private constructor(private readonly repository: PersonalUsageClickHouseRepository) {
    super();
  }

  static create(repository: PersonalUsageClickHouseRepository): AppPersonalUsageReader {
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

  findDailyBuckets(input: { tenantId: string; window: PortablePersonalUsageWindow }) {
    return this.repository.findDailyBuckets(this.toAppInput(input));
  }

  findModelBreakdown(input: {
    tenantId: string;
    window: PortablePersonalUsageWindow;
    limit: number;
  }) {
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
  }) {
    return this.repository.findIngestionPrincipalBuckets(this.toAppPrincipalInput(input));
  }

  findIngestionPrincipalBreakdown(input: {
    tenantId: string;
    userId: string;
    window: PortablePersonalUsageWindow;
  }) {
    return this.repository.findIngestionPrincipalBreakdown(
      this.toAppPrincipalInput(input),
    );
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

/** Binds the app's ClickHouse client to the canonical service once. */
export class AppPersonalUsageAdapter {
  private constructor(
    private readonly repository: PersonalUsageClickHouseRepository | undefined,
  ) {}

  static create(
    repository: PersonalUsageClickHouseRepository | undefined,
  ): AppPersonalUsageAdapter {
    return new AppPersonalUsageAdapter(repository);
  }

  build(): DefaultGovernancePersonalUsageService {
    return DefaultGovernancePersonalUsageService.create({
      reader: this.repository
        ? AppPersonalUsageReader.create(this.repository)
        : undefined,
    });
  }
}
