import { type ClickHouseQueryClient, type IdBoundOptions } from "@langwatch/clickhouse-client";

import type { ExperimentEventingClickHouseClient } from "../experiment-clickhouse.repository.ts";

type ClickHouseRow = Readonly<Record<string, unknown>>;

function isRow(value: unknown): value is ClickHouseRow {
  return typeof value === "object" && value !== null;
}

/**
 * One tenant's view of the process's routing `clickhouse` member, in the
 * shape Experiment's repositories hold: built reads go straight to the member.
 */
export class ClickHouseExperimentSession implements ExperimentEventingClickHouseClient {
  readonly read: ClickHouseQueryClient["read"];

  private constructor(
    private readonly clickhouse: ClickHouseQueryClient,
    private readonly tenantId: string,
  ) {
    this.read = (input) => clickhouse.read(input);
  }

  /** Resolves each tenant's session over the one routing member. */
  static resolverOver(
    clickhouse: ClickHouseQueryClient,
  ): (tenantId: string) => Promise<ClickHouseExperimentSession> {
    return (tenantId) => Promise.resolve(new ClickHouseExperimentSession(clickhouse, tenantId));
  }

  /** Raw, for the run-pair enrichment reads only, until the builder binds Array(Tuple). */
  async query(input: {
    query: string;
    query_params?: Record<string, unknown>;
    format: "JSONEachRow";
    idBound?: IdBoundOptions;
  }): Promise<{ json<T>(): Promise<T[]> }> {
    const request = {
      tenantId: this.tenantId,
      sql: input.query,
      params: input.query_params,
      ...(input.idBound === undefined ? {} : { idBound: input.idBound }),
    };
    return { json: async <T>() => (await this.clickhouse.query<T>(request)).rows };
  }

  /** Whether this tenant's target holds each column of `table`; an unreadable list holds all. */
  holds({ table }: { table: string }): Promise<(name: string) => boolean> {
    return this.clickhouse
      .columns({ tenantId: this.tenantId })
      .holds({ table })
      .catch(() => () => true);
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
