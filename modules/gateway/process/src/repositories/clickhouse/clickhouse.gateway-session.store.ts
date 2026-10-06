import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";

/**
 * The ClickHouse surface this feature uses, structurally, so the package
 * does not depend on the driver — the driver's stricter types (a nested-map
 * setting, a typed insert result) are not assignable here (contravariance).
 */
export type GatewayClickHouseClient = {
  query(input: {
    query: string;
    query_params?: Record<string, unknown>;
    format: "JSONEachRow";
    clickhouse_settings?: Record<string, string | number | boolean | undefined>;
    /** Set when the statement genuinely spans tenants; see the tenant-scope guard. */
    unscoped?: { reason: string };
    /** One organisation's projects a `TenantId IN (...)` read binds, exactly. */
    tenantIds?: readonly string[];
    /** Abandons the read, retries included, once it aborts. */
    signal?: AbortSignal;
  }): Promise<{ json<T = unknown>(): Promise<T[]> }>;
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
 * One tenant's view of the process's ONE routing ClickHouse client: the
 * driver-shaped calls the gateway repositories make, translated to the
 * routing client's own. A private server answers when `organizationId` names one.
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
  ) {}

  async query(input: {
    query: string;
    query_params?: Record<string, unknown>;
    format: "JSONEachRow";
    clickhouse_settings?: Record<string, string | number | boolean | undefined>;
    unscoped?: { reason: string };
    tenantIds?: readonly string[];
    signal?: AbortSignal;
  }): Promise<{ json<T = unknown>(): Promise<T[]> }> {
    const { rows } = await this.clickhouse.query<unknown>({
      tenantId: this.tenantId,
      ...(this.organizationId === undefined ? {} : { organizationId: this.organizationId }),
      sql: input.query,
      params: input.query_params,
      settings: input.clickhouse_settings as Record<string, string | number> | undefined,
      ...(input.unscoped ? { unscoped: input.unscoped } : {}),
      ...(input.tenantIds ? { tenantIds: input.tenantIds } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    });

    return { json: <T = unknown>() => Promise.resolve(rows as T[]) };
  }

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
