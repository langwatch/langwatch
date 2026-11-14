import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";

/**
 * The ClickHouse surface this feature uses, structurally, so the package
 * does not depend on the driver — the driver's stricter types (a nested-map
 * setting, a typed insert result) are not assignable here (contravariance).
 */
export type GatewayClickHouseClient = Pick<ClickHouseQueryClient, "read"> & {
  insert(input: {
    table: string;
    values: Record<string, unknown>[];
    format?: "JSONEachRow";
    clickhouse_settings?: Record<string, string | number | boolean | undefined>;
  }): Promise<unknown>;
};

export type GatewayClickHouseResolver = (tenantId: string) => Promise<GatewayClickHouseClient>;

/** Resolves the tenant-scoped ClickHouse client at the Gateway boundary. */
export interface GatewayClickHouse {
  resolve(tenantId: string): Promise<GatewayClickHouseClient>;
}

/**
 * One tenant's view of the process's ONE routing ClickHouse client: built reads
 * and driver-shaped inserts, translated to the routing client's own. A private
 * server answers when `organizationId` names one.
 */
export class ClickHouseGatewaySession implements GatewayClickHouseClient {
  static create(input: {
    clickhouse: ClickHouseQueryClient;
    tenantId: string;
    organizationId?: string | undefined;
  }): ClickHouseGatewaySession {
    return new ClickHouseGatewaySession(input.clickhouse, input.tenantId, input.organizationId);
  }

  private constructor(
    private readonly clickhouse: ClickHouseQueryClient,
    private readonly tenantId: string,
    /** Routes an install-wide read to one private server; the shared one when absent. */
    private readonly organizationId: string | undefined,
  ) {
    this.read = (input) =>
      this.clickhouse.read({
        ...input,
        organizationId: input.organizationId ?? this.organizationId,
      });
  }

  /** A built statement, sent to this session's private server when the session names one. */
  readonly read: ClickHouseQueryClient["read"];

  async insert(input: {
    table: string;
    values: Record<string, unknown>[];
    format?: "JSONEachRow";
    clickhouse_settings?: Record<string, string | number | boolean | undefined>;
  }): Promise<unknown> {
    await this.clickhouse.insert({
      tenantId: this.tenantId,
      table: input.table,
      rows: input.values,
      settings: input.clickhouse_settings as Record<string, string | number> | undefined,
    });

    return undefined;
  }
}
