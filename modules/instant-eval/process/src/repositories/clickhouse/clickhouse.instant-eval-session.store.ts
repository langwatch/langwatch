import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";

/**
 * What a repository holds per tenant (ADR-147): built reads go straight to the process member;
 * the insert keeps the driver's shape it was written against.
 */
type InstantEvalClickHouseClient = Pick<ClickHouseQueryClient, "read"> & {
  insert(input: {
    table: string;
    values: Record<string, unknown>[];
    format?: "JSONEachRow";
    clickhouse_settings?: Record<string, string | number | boolean | undefined>;
  }): Promise<unknown>;
};

/** Resolves the tenant's ClickHouse client; every read names the tenant first. */
export type InstantEvalClickHouseResolver = (
  tenantId: string,
) => Promise<InstantEvalClickHouseClient>;

/**
 * The process's one routing ClickHouse member, carried per tenant. Not a
 * second connection — the member already routes and guards every statement.
 */
export type InstantEvalClickHouseMember = Pick<ClickHouseQueryClient, "read"> & {
  insert(input: {
    tenantId: string;
    table: string;
    rows: Record<string, unknown>[];
    settings?: Record<string, string | number>;
  }): Promise<unknown>;
};

/** One tenant's view of the process member, as a repository reads it. */
export class ClickHouseInstantEvalSession implements InstantEvalClickHouseClient {
  readonly read: ClickHouseQueryClient["read"];

  constructor(
    private readonly clickhouse: InstantEvalClickHouseMember,
    private readonly tenantId: string,
  ) {
    this.read = (input) => clickhouse.read(input);
  }

  async insert(input: {
    table: string;
    values: Record<string, unknown>[];
    clickhouse_settings?: Record<string, string | number | boolean | undefined>;
  }): Promise<unknown> {
    await this.clickhouse.insert({
      tenantId: this.tenantId,
      table: input.table,
      rows: input.values,
      ...(input.clickhouse_settings ? { settings: settingsOf(input.clickhouse_settings) } : {}),
    });
    return undefined;
  }
}

/** The settings the member takes: booleans and absences dropped. */
function settingsOf(
  settings: Record<string, string | number | boolean | undefined>,
): Record<string, string | number> {
  const carried: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(settings)) {
    if (typeof value === "string" || typeof value === "number") carried[name] = value;
    else if (typeof value === "boolean") carried[name] = value ? 1 : 0;
  }
  return carried;
}
