import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";

/** Minimal ClickHouse client primitive; rows arrive unknown and each caller parses its own. */
export interface TraceClickHouseClient {
  query(input: {
    query: string;
    query_params?: Record<string, unknown>;
    format: "JSONEachRow";
    clickhouse_settings?: Record<string, string>;
  }): Promise<{ json(): Promise<unknown[]> }>;
}

export interface TraceClickHouseWriteClient extends TraceClickHouseClient {
  insert(input: {
    table: string;
    /**
     * Read-only on purpose: nothing behind this port mutates the batch it
     * is handed, so a caller holding a `readonly` row array (the Eventing
     * client a background process composes) satisfies it without copying.
     */
    values: readonly unknown[];
    format: "JSONEachRow";
    clickhouse_settings?: Record<string, number>;
  }): Promise<unknown>;
}

export type TraceClickHouseResolver = (tenantId: string) => Promise<TraceClickHouseClient>;
export type TraceClickHouseWriteResolver = (
  tenantId: string,
) => Promise<TraceClickHouseWriteClient>;

export abstract class TraceClickHouse {
  abstract resolve(tenantId: string): Promise<TraceClickHouseClient>;
}

/**
 * The routed ClickHouse member, adapted to the low-level client Trace's
 * repositories ask for. One tenant per resolution, exactly as the tables' own
 * rule requires: every statement names its tenant.
 */
export class MemberTraceClickHouseClientRepository implements TraceClickHouseWriteClient {
  /** The member, as the tenant-keyed resolver every Trace repository takes. */
  static resolverFor(clickhouse: ClickHouseQueryClient): TraceClickHouseWriteResolver {
    return (tenantId) =>
      Promise.resolve(MemberTraceClickHouseClientRepository.create({ clickhouse, tenantId }));
  }

  static create(input: {
    clickhouse: ClickHouseQueryClient;
    tenantId: string;
  }): MemberTraceClickHouseClientRepository {
    return new MemberTraceClickHouseClientRepository(input.clickhouse, input.tenantId);
  }

  private constructor(
    private readonly clickhouse: ClickHouseQueryClient,
    private readonly tenantId: string,
  ) {}

  async query(input: {
    query: string;
    query_params?: Record<string, unknown>;
    format: "JSONEachRow";
    clickhouse_settings?: Record<string, string>;
  }): Promise<{ json(): Promise<unknown[]> }> {
    const result = await this.clickhouse.query<unknown>({
      tenantId: this.tenantId,
      sql: input.query,
      params: input.query_params ?? {},
      ...(input.clickhouse_settings ? { settings: input.clickhouse_settings } : {}),
    });
    return { json: async () => result.rows };
  }

  async insert(input: {
    table: string;
    values: readonly unknown[];
    format: "JSONEachRow";
    clickhouse_settings?: Record<string, number>;
  }): Promise<unknown> {
    return this.clickhouse.insert({
      tenantId: this.tenantId,
      table: input.table,
      rows: input.values as readonly Record<string, unknown>[],
      ...(input.clickhouse_settings ? { settings: input.clickhouse_settings } : {}),
    });
  }
}
