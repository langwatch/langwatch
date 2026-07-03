import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import { SecurityError } from "~/server/event-sourcing/services/errorHandling";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";
import { createLogger, type Logger } from "~/utils/logger/server";

/**
 * Shared base classes for the ADR-034 write-side ClickHouse analytics
 * repositories. Every concrete repo (evaluation / experiment / simulation /
 * suite × slim + rollup) does the same insert dance — validate the tenant,
 * resolve the tenant-scoped client, serialize rows to JSONEachRow, log +
 * rethrow on failure. Only the table name, the log context id fields, and
 * the per-aggregate `toRecord` mapper differ.
 *
 * Consolidating here s5014-001 (~950 LOC saved across 8 files) — same
 * shape via one base per pattern instead of copy-paste per aggregate.
 */

interface AnalyticsRepoConfig<TRow extends { tenantId: string }, TRecord> {
  /** ClickHouse table name (e.g. `evaluation_analytics`). */
  tableName: string;
  /** Pino logger name (e.g. `langwatch:app-layer:evaluations:...`). */
  loggerName: string;
  /** Log-context id fields for the aggregate (e.g. `{evaluationId}`). */
  entityIdOf: (row: TRow) => Record<string, string | number | undefined>;
  /** Map the app-side row to the CH JSONEachRow record. */
  toRecord: (row: TRow, retentionDays: number) => TRecord;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertSingleTenant<TRow extends { tenantId: string }>(
  rows: Iterable<TRow>,
  tenantId: string,
  scope: string,
): void {
  for (const row of rows) {
    if (row.tenantId !== tenantId) {
      throw new SecurityError(
        scope,
        "all rows in a single batch must share the same tenantId",
        tenantId,
        { mismatchedTenantId: row.tenantId },
      );
    }
  }
}

/**
 * Slim-projection base — `upsert` on a single row, `upsertBatch` on N.
 *
 * Single-row `wait_for_async_insert: 0` (fire-and-forget latency), batch
 * `wait_for_async_insert: 1` (correctness — the caller batched for a reason).
 */
export abstract class BaseAnalyticsSlimClickHouseRepository<
  TRow extends { tenantId: string },
  TRecord,
> {
  protected readonly logger: Logger;
  protected readonly resolveClient: ClickHouseClientResolver;
  protected readonly config: AnalyticsRepoConfig<TRow, TRecord>;

  constructor(
    resolveClient: ClickHouseClientResolver,
    config: AnalyticsRepoConfig<TRow, TRecord>,
  ) {
    this.resolveClient = resolveClient;
    this.config = config;
    this.logger = createLogger(config.loggerName);
  }

  async upsert(
    row: TRow,
    retentionDays: number = PLATFORM_DEFAULT_RETENTION_DAYS,
  ): Promise<void> {
    const scope = `${this.config.tableName}.upsert`;
    EventUtils.validateTenantId({ tenantId: row.tenantId }, scope);

    try {
      const client = await this.resolveClient(row.tenantId);
      await client.insert({
        table: this.config.tableName,
        values: [this.config.toRecord(row, retentionDays)],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 0 },
      });
    } catch (error) {
      this.logger.error(
        {
          tenantId: row.tenantId,
          ...this.config.entityIdOf(row),
          error: formatError(error),
        },
        `Failed to upsert ${this.config.tableName} row into ClickHouse`,
      );
      throw error;
    }
  }

  async upsertBatch(
    entries: Array<{ row: TRow; retentionDays?: number }>,
  ): Promise<void> {
    if (entries.length === 0) return;

    const scope = `${this.config.tableName}.upsertBatch`;
    const tenantId = entries[0]!.row.tenantId;
    EventUtils.validateTenantId({ tenantId }, scope);
    assertSingleTenant(
      entries.map((e) => e.row),
      tenantId,
      scope,
    );

    try {
      const client = await this.resolveClient(tenantId);
      await client.insert({
        table: this.config.tableName,
        values: entries.map(({ row, retentionDays }) =>
          this.config.toRecord(
            row,
            retentionDays ?? PLATFORM_DEFAULT_RETENTION_DAYS,
          ),
        ),
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      this.logger.error(
        {
          tenantId,
          count: entries.length,
          error: formatError(error),
        },
        `Failed to batch upsert ${this.config.tableName} rows into ClickHouse`,
      );
      throw error;
    }
  }
}

/**
 * Rollup-projection base — `insertRow` on a single row, `insertRows` on N.
 * Rollup rows are new increments (not versioned upserts) so all inserts
 * use `wait_for_async_insert: 1` for correctness.
 */
export abstract class BaseAnalyticsRollupClickHouseRepository<
  TRow extends { tenantId: string },
  TRecord,
> {
  protected readonly logger: Logger;
  protected readonly resolveClient: ClickHouseClientResolver;
  protected readonly config: AnalyticsRepoConfig<TRow, TRecord>;

  constructor(
    resolveClient: ClickHouseClientResolver,
    config: AnalyticsRepoConfig<TRow, TRecord>,
  ) {
    this.resolveClient = resolveClient;
    this.config = config;
    this.logger = createLogger(config.loggerName);
  }

  async insertRow(
    row: TRow,
    retentionDays: number = PLATFORM_DEFAULT_RETENTION_DAYS,
  ): Promise<void> {
    const scope = `${this.config.tableName}.insertRow`;
    EventUtils.validateTenantId({ tenantId: row.tenantId }, scope);

    try {
      const client = await this.resolveClient(row.tenantId);
      await client.insert({
        table: this.config.tableName,
        values: [this.config.toRecord(row, retentionDays)],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      this.logger.error(
        {
          tenantId: row.tenantId,
          ...this.config.entityIdOf(row),
          error: formatError(error),
        },
        `Failed to insert ${this.config.tableName} row into ClickHouse`,
      );
      throw error;
    }
  }

  async insertRows(
    rows: TRow[],
    retentionDays: number = PLATFORM_DEFAULT_RETENTION_DAYS,
  ): Promise<void> {
    if (rows.length === 0) return;

    const scope = `${this.config.tableName}.insertRows`;
    for (const row of rows) {
      EventUtils.validateTenantId({ tenantId: row.tenantId }, scope);
    }
    const tenantId = rows[0]!.tenantId;
    assertSingleTenant(rows, tenantId, scope);

    try {
      const client = await this.resolveClient(tenantId);
      await client.insert({
        table: this.config.tableName,
        values: rows.map((row) => this.config.toRecord(row, retentionDays)),
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      this.logger.error(
        {
          count: rows.length,
          error: formatError(error),
        },
        `Failed to bulk insert ${this.config.tableName} rows into ClickHouse`,
      );
      throw error;
    }
  }
}
