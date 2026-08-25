// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ClickHouseClient } from "@clickhouse/client";
import type { GovernanceActivityMonitorService } from "@langwatch/enterprise-governance-contract";
import {
  GovernanceClickHouseClientPort,
  GovernanceClickHouseResolverPort,
  PostgresIngestionSourceActivityAdapter,
} from "@langwatch/enterprise-governance-server";

class AppGovernanceClickHouseClientPort extends GovernanceClickHouseClientPort {
  private constructor(private readonly client: ClickHouseClient) {
    super();
  }

  static create(client: ClickHouseClient): AppGovernanceClickHouseClientPort {
    return new AppGovernanceClickHouseClientPort(client);
  }

  query(input: Parameters<GovernanceClickHouseClientPort["query"]>[0]) {
    return this.client.query(input);
  }
}

class AppGovernanceClickHouseResolverPort extends GovernanceClickHouseResolverPort {
  private constructor(
    private readonly resolveClient: (
      organizationId: string,
    ) => Promise<ClickHouseClient | null>,
  ) {
    super();
  }

  static create(
    resolveClient: (organizationId: string) => Promise<ClickHouseClient | null>,
  ): AppGovernanceClickHouseResolverPort {
    return new AppGovernanceClickHouseResolverPort(resolveClient);
  }

  async tryResolve(
    organizationId: string,
  ): Promise<GovernanceClickHouseClientPort | null> {
    const client = await this.resolveClient(organizationId);
    return client ? AppGovernanceClickHouseClientPort.create(client) : null;
  }
}

/** Composes the one Activity Monitor service owned by the process App. */
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

  build(): GovernanceActivityMonitorService {
    return PostgresIngestionSourceActivityAdapter.create({
      database: this.options.database,
      clickhouse: AppGovernanceClickHouseResolverPort.create(this.options.resolveClient),
    }).build();
  }
}
