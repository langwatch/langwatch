// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ClickHouseClient } from "@clickhouse/client";
import type {
  ActivityEventDetailRow,
  ActivityMonitorPagedWindowQuery,
  ActivityMonitorSummary,
  ActivityMonitorWindowQuery,
  IngestionSourceHealthRow,
  RecentAnomalyRow,
  SourceHealthMetrics,
  SpendByDepartmentRow,
  SpendByTeamRow,
  SpendByUserRow,
  SpendOverTimeGroupBy,
  SpendOverTimeResult,
} from "@langwatch/enterprise-governance-contract";
import {
  GovernanceClickHouseClientPort,
  GovernanceClickHouseResolverPort,
} from "@langwatch/enterprise-governance-server";

type GovernanceClickHouseQuery = {
  query: string;
  query_params?: Record<string, unknown>;
  format: "JSONEachRow";
};

export type GovernanceActivityMonitorCapability = {
  summary(input: ActivityMonitorWindowQuery): Promise<ActivityMonitorSummary>;
  spendByUser(input: ActivityMonitorPagedWindowQuery): Promise<SpendByUserRow[]>;
  spendByTeam(input: ActivityMonitorPagedWindowQuery): Promise<SpendByTeamRow[]>;
  spendByDepartment(input: ActivityMonitorWindowQuery): Promise<SpendByDepartmentRow[]>;
  spendOverTime(input: {
    organizationId: string;
    windowDays: number;
    groupBy: SpendOverTimeGroupBy;
  }): Promise<SpendOverTimeResult>;
  recentAnomalies(input: { organizationId: string; limit?: number }): Promise<RecentAnomalyRow[]>;
  ingestionSourcesHealth(input: { organizationId: string }): Promise<IngestionSourceHealthRow[]>;
  eventsForSource(input: {
    organizationId: string;
    sourceId: string;
    limit?: number;
    beforeIso?: string;
  }): Promise<ActivityEventDetailRow[]>;
  sourceHealthMetrics(input: {
    organizationId: string;
    sourceId: string;
  }): Promise<SourceHealthMetrics>;
};

class AppGovernanceClickHouseClientPort extends GovernanceClickHouseClientPort {
  private constructor(private readonly client: ClickHouseClient) {
    super();
  }

  static create(client: ClickHouseClient): AppGovernanceClickHouseClientPort {
    return new AppGovernanceClickHouseClientPort(client);
  }

  query(input: GovernanceClickHouseQuery) {
    return this.client.query(input);
  }
}

class AppGovernanceClickHouseResolverPort extends GovernanceClickHouseResolverPort {
  private constructor(
    private readonly resolveClient: (organizationId: string) => Promise<ClickHouseClient | null>,
  ) {
    super();
  }

  static create(
    resolveClient: (organizationId: string) => Promise<ClickHouseClient | null>,
  ): AppGovernanceClickHouseResolverPort {
    return new AppGovernanceClickHouseResolverPort(resolveClient);
  }

  async tryResolve(organizationId: string): Promise<GovernanceClickHouseClientPort | null> {
    const client = await this.resolveClient(organizationId);
    return client ? AppGovernanceClickHouseClientPort.create(client) : null;
  }
}

/** Binds the app's ClickHouse resolver to the server installation boundary. */
export class AppIngestionSourceActivityAdapter {
  private constructor(
    private readonly options: {
      database: object;
      resolveClient: (organizationId: string) => Promise<ClickHouseClient | null>;
    },
  ) {}

  static create(options: {
    database: object;
    resolveClient: (organizationId: string) => Promise<ClickHouseClient | null>;
  }): AppIngestionSourceActivityAdapter {
    return new AppIngestionSourceActivityAdapter(options);
  }

  clickhouse(): AppGovernanceClickHouseResolverPort {
    return AppGovernanceClickHouseResolverPort.create(this.options.resolveClient);
  }
}
