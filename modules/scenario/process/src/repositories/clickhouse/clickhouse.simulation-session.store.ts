import type { ClickHouseSettings } from "@clickhouse/client";
import {
  type ClickHouseColumns,
  type ClickHouseQueryClient,
  type IdBoundOptions,
} from "@langwatch/clickhouse-client";
import { SecurityError } from "@langwatch/eventing";

type SimulationEventingClickHouseClient = {
  query(input: {
    query: string;
    query_params: Record<string, unknown>;
    format: "JSONEachRow";
    clickhouse_settings?: ClickHouseSettings;
    /** For a statement carrying `{{idBound}}`: a time the caller has, and today's fallback. */
    idBound?: IdBoundOptions;
  }): Promise<{ json<Row>(): Promise<Row[]> }>;
  insert(input: {
    table: string;
    values: readonly Readonly<Record<string, unknown>>[];
    format: "JSONEachRow";
    clickhouse_settings?: ClickHouseSettings;
  }): Promise<unknown>;
  /** A statement the typed builder built; it names its own tenant scope. */
  read: ClickHouseQueryClient["read"];
  /** Absent on a bare driver client (tests): every column is then named. */
  select?(input: Parameters<ClickHouseColumns["select"]>[0]): Promise<string>;
  /** Which columns of a table this tenant's target holds, for `fn.heldOr`. */
  holds(input: { table: string }): Promise<(name: string) => boolean>;
};

export type SimulationEventingClickHouseResolver = (
  tenantId: string,
) => Promise<SimulationEventingClickHouseClient>;

/** One tenant's view of the routing ClickHouse member, as evaluation's session reads it. */
export class ClickHouseSimulationSession implements SimulationEventingClickHouseClient {
  constructor(
    private readonly clickhouse: ClickHouseQueryClient,
    private readonly tenantId: string,
  ) {}

  static resolver(clickhouse: ClickHouseQueryClient): SimulationEventingClickHouseResolver {
    return (tenantId) => Promise.resolve(new ClickHouseSimulationSession(clickhouse, tenantId));
  }

  async query(
    input: Parameters<SimulationEventingClickHouseClient["query"]>[0],
  ): Promise<{ json<Row>(): Promise<Row[]> }> {
    const request = {
      tenantId: this.tenantId,
      sql: input.query,
      params: input.query_params,
      ...(input.clickhouse_settings ? { settings: settingsOf(input.clickhouse_settings) } : {}),
      ...(input.idBound === undefined ? {} : { idBound: input.idBound }),
    };

    return { json: async <Row>() => (await this.clickhouse.query<Row>(request)).rows };
  }

  /** Sends a built statement only when it is this session's tenant's, else refuses by name. */
  read: ClickHouseQueryClient["read"] = (input) => {
    const { statement } = input;
    const own =
      statement.identity === "reader" &&
      statement.kind === "tenant" &&
      statement.tenantId === this.tenantId &&
      statement.routeTenantId === this.tenantId &&
      (statement.tenantIds ?? [this.tenantId]).every((id) => id === this.tenantId);
    if (own) return this.clickhouse.read(input);
    return Promise.reject(
      new SecurityError({
        operation: "ClickHouseSimulationSession.read",
        message: "A built read sent through a tenant's session must be scoped to that tenant",
        tenantId: this.tenantId,
        context: { identity: statement.identity, kind: statement.kind },
      }),
    );
  };

  holds({ table }: { table: string }): Promise<(name: string) => boolean> {
    return this.clickhouse.columns({ tenantId: this.tenantId }).holds({ table });
  }

  /** A select list naming only the columns this tenant's target has, the rest as defaults. */
  select(input: Parameters<ClickHouseColumns["select"]>[0]): Promise<string> {
    return this.clickhouse.columns({ tenantId: this.tenantId }).select(input);
  }

  async insert(input: Parameters<SimulationEventingClickHouseClient["insert"]>[0]): Promise<void> {
    await this.clickhouse.insert({
      tenantId: this.tenantId,
      table: input.table,
      rows: input.values,
      ...(input.clickhouse_settings ? { settings: settingsOf(input.clickhouse_settings) } : {}),
    });
  }
}

function settingsOf(settings: Readonly<Record<string, unknown>>): Record<string, string | number> {
  const carried: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(settings)) {
    if (typeof value === "string" || typeof value === "number") carried[name] = value;
    else if (typeof value === "boolean") carried[name] = value ? 1 : 0;
  }
  return carried;
}
