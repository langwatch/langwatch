import type { ClickHouseSettings } from "@clickhouse/client";
import {
  type ClickHouseColumns,
  type ClickHouseQueryClient,
  type IdIndexBounds,
  type IdIndexLookup,
  type IdIndexReader,
  type IdIndexFlags,
  type IdIndexKey,
  type WindowFallback,
  type WindowFragment,
  indexedRead,
} from "@langwatch/clickhouse-client";

type SimulationEventingClickHouseClient = {
  query(input: {
    query: string;
    query_params: Record<string, unknown>;
    format: "JSONEachRow";
    clickhouse_settings?: ClickHouseSettings;
  }): Promise<{ json<Row>(): Promise<Row[]> }>;
  insert(input: {
    table: string;
    values: readonly Readonly<Record<string, unknown>>[];
    format: "JSONEachRow";
    clickhouse_settings?: ClickHouseSettings;
  }): Promise<unknown>;
  /** Absent on a bare driver client (tests): every column is then named. */
  select?(input: Parameters<ClickHouseColumns["select"]>[0]): Promise<string>;
} & Partial<IdIndexReader>;

/** Never asked: a read through it carries no flags, so `indexedRead` takes today's path. */
const NO_ID_INDEX: IdIndexReader = {
  targetOf: () => Promise.reject(new Error("This client cannot name a ClickHouse target")),
  indexBounds: () => Promise.reject(new Error("This client cannot read an id index")),
};

function canReadIdIndex(client: Partial<IdIndexReader>): client is IdIndexReader {
  return typeof client.targetOf === "function" && typeof client.indexBounds === "function";
}

/**
 * `indexedRead` over a session client. A client that cannot answer the index (a bare driver in a
 * test) reads as the flag off, so a repository never branches on what it was handed.
 */
export function readByIdIndex<T>({
  client,
  idIndex,
  ...options
}: {
  client: Partial<IdIndexReader>;
  idIndex?: IdIndexFlags | undefined;
  tenantId: string;
  table: string;
  index: string;
  key: IdIndexKey;
  fallback: WindowFallback;
  isEmpty: (result: T) => boolean;
  run: (window: WindowFragment | null) => Promise<T>;
}): Promise<T> {
  if (!canReadIdIndex(client)) {
    return indexedRead({ ...options, client: NO_ID_INDEX, idIndex: undefined });
  }
  return indexedRead({ ...options, client, idIndex });
}

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
    };

    return { json: async <Row>() => (await this.clickhouse.query<Row>(request)).rows };
  }

  /** The target `tenantId` lands on, which keys the module's id-index flag. */
  targetOf(input: { tenantId: string }): Promise<string> {
    return this.clickhouse.targetOf(input);
  }

  /** The time range one id's rows span, from the id index. */
  indexBounds(input: IdIndexLookup & { tenantId: string }): Promise<IdIndexBounds> {
    return this.clickhouse.indexBounds(input);
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
