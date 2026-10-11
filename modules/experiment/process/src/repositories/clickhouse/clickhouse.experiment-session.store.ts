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

import type {
  ExperimentEventingClickHouseClient,
  ExperimentEventingClickHouseResolver,
  ExperimentEventingClickHouseResult,
} from "../experiment-clickhouse.repository.ts";

type ClickHouseRow = Readonly<Record<string, unknown>>;

function isRow(value: unknown): value is ClickHouseRow {
  return typeof value === "object" && value !== null;
}

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

  /** The target this session's tenant lands on, which keys the module's id-index flag. */
  targetOf(_input: { tenantId: string }): Promise<string> {
    return this.clickhouse.targetOf({ tenantId: this.tenantId });
  }

  /** The time range one id's rows span, from this session's tenant's id index. */
  indexBounds(input: IdIndexLookup & { tenantId: string }): Promise<IdIndexBounds> {
    return this.clickhouse.indexBounds({ ...input, tenantId: this.tenantId });
  }

  /** A select list naming only the columns this tenant's target has, the rest as defaults. */
  select(input: Parameters<ClickHouseColumns["select"]>[0]): Promise<string> {
    return this.clickhouse.columns({ tenantId: this.tenantId }).select(input);
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
