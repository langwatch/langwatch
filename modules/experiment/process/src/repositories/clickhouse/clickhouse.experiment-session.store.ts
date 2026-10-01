import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";

import type {
  ExperimentEventingClickHouseClient,
  ExperimentEventingClickHouseResult,
} from "../experiment-clickhouse.repository.ts";
import type { ExperimentEventingClickHouseResolver } from "./clickhouse.experiment-clickhouse.repository.ts";

type ClickHouseRow = Readonly<Record<string, unknown>>;

function isRow(value: unknown): value is ClickHouseRow {
  return typeof value === "object" && value !== null;
}

/**
 * One tenant's view of the process's routing `clickhouse` member, in the
 * `.query()`/`.insert()` shape Experiment's repositories were written against.
 */
export class ClickHouseExperimentSession implements ExperimentEventingClickHouseClient {
  private constructor(
    private readonly clickhouse: ClickHouseQueryClient,
    private readonly tenantId: string,
  ) {}

  /** Resolves each tenant's session over the one routing member. */
  static resolverOver(clickhouse: ClickHouseQueryClient): ExperimentEventingClickHouseResolver {
    return (tenantId) => Promise.resolve(new ClickHouseExperimentSession(clickhouse, tenantId));
  }

  async query(input: {
    query: string;
    query_params?: Record<string, unknown>;
    format: "JSONEachRow";
  }): Promise<ExperimentEventingClickHouseResult> {
    const request = {
      tenantId: this.tenantId,
      sql: input.query,
      params: input.query_params,
    };
    return { json: async <T>() => (await this.clickhouse.query<T>(request)).rows };
  }

  async insert(input: {
    table: string;
    values: readonly unknown[];
    format: "JSONEachRow";
    clickhouse_settings?: Record<string, number>;
  }): Promise<unknown> {
    const rows = input.values;
    if (!rows.every(isRow)) throw new TypeError(`a row for ${input.table} is not an object`);
    await this.clickhouse.insert({
      tenantId: this.tenantId,
      table: input.table,
      rows,
      settings: input.clickhouse_settings,
    });
    return undefined;
  }
}
