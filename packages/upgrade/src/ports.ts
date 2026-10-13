/** The Postgres connection the ledger lives in. A `pg` Pool or PoolClient fits as it is. */
export interface UpgradePostgres {
  query<Row extends object>(text: string, values?: unknown[]): Promise<{ rows: Row[] }>;
}

/** The ClickHouse connection whose `goose_db_version` the seed reads, rows as JSON. */
export interface UpgradeClickHouse {
  queryRows<Row extends object>(sql: string): Promise<Row[]>;
}
