// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  GovernanceSetupActivityPort,
  type GovernanceSetupState,
  type GovernanceSetupStateService,
  PostgresGovernanceSetupStateAdapter,
} from "@langwatch/enterprise-governance-server";
import type { PrismaClient } from "~/generated/prisma/client";
import type { GovernanceTraceActivityClickHouseRepository } from "./governanceTraceActivity.clickhouse.repository";

class AppGovernanceSetupActivityPort extends GovernanceSetupActivityPort {
  private constructor(
    private readonly repository: GovernanceTraceActivityClickHouseRepository,
  ) {
    super();
  }

  static create(
    repository: GovernanceTraceActivityClickHouseRepository,
  ): AppGovernanceSetupActivityPort {
    return new AppGovernanceSetupActivityPort(repository);
  }

  hasRecentActivity(
    input: Parameters<GovernanceSetupActivityPort["hasRecentActivity"]>[0],
  ): Promise<boolean> {
    return this.repository.hasRecentActivity(input);
  }
}

export class AppGovernanceSetupStateService {
  private constructor(private readonly service: GovernanceSetupStateService) {}

  static create(options: {
    prisma: PrismaClient;
    traceActivity: GovernanceTraceActivityClickHouseRepository | undefined;
  }): AppGovernanceSetupStateService {
    return new AppGovernanceSetupStateService(
      PostgresGovernanceSetupStateAdapter.create({
        database: options.prisma,
        activity: options.traceActivity
          ? AppGovernanceSetupActivityPort.create(options.traceActivity)
          : undefined,
      }).build(),
    );
  }

  resolve(organizationId: string): Promise<GovernanceSetupState> {
    return this.service.resolve(organizationId);
  }
}
