import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";

import type {
  TraceClickHouseWriteClient,
  TraceClickHouseWriteResolver,
} from "../trace-clickhouse-client.repository.ts";

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

  async query<Row>(input: {
    query: string;
    query_params?: Record<string, unknown>;
    format: "JSONEachRow";
    clickhouse_settings?: Record<string, string>;
  }): Promise<{ json<T = Row>(): Promise<T[]> }> {
    const result = await this.clickhouse.query<Row>({
      tenantId: this.tenantId,
      sql: input.query,
      params: input.query_params ?? {},
      ...(input.clickhouse_settings ? { settings: input.clickhouse_settings } : {}),
    });
    return { json: async <T = Row>() => result.rows as unknown as T[] };
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
