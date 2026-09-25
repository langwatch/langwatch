import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import {
  RetroactiveMutationInProgressError,
  retroactiveMutationProgressSchema,
  type RetentionCategory,
  type RetroactiveMutationProgress,
} from "@langwatch/data-retention-contract";
import { RETENTION_TABLE_CATEGORY_MAP } from "@langwatch/data-retention-contract/retention-tables";
import { z } from "zod";

import type { RetroactiveRetentionRepository } from "../retroactive-retention.repository.ts";
import {
  eventLogRetentionCategoryFromMutationCommand,
  eventLogRetentionCategoryMutationMarkerSql,
  eventLogRetentionCategorySqlPredicate,
} from "./event-log-retention-sql.ts";

const EVENT_LOG_TABLE = "event_log";

const mutationRowSchema = z
  .object({
    mutationId: z.string(),
    table: z.string(),
    isDone: z.number(),
    partsToDo: z.number(),
    createTime: z.string(),
    // Selected only so `event_log` rows can recover the category marker
    // stamped by `eventLogRetentionCategoryMutationMarkerSql`; other rows
    // never carry one worth reading. Dropped again before a row leaves this
    // repository (`retroactiveMutationProgressSchema` has no such field).
    command: z.string().optional(),
  })
  .strict();

const mutationRowsSchema = z.array(mutationRowSchema);

const tenantFilterSql = "position(command, {tenantFilterNeedle:String}) > 0";

function tenantFilterParams(projectId: string): Record<string, string> {
  const escapedProjectId = projectId.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return { tenantFilterNeedle: `WHERE TenantId = '${escapedProjectId}'` };
}

/**
 * Retention rewrites, over the process's one ClickHouse client. It routes
 * each statement to the tenant's own server, so this repository holds no
 * per-tenant client — every call below names the project it acts for.
 */
export class ClickHouseRetroactiveRetentionRepository implements RetroactiveRetentionRepository {
  static create(options: {
    clickhouse: ClickHouseQueryClient;
  }): ClickHouseRetroactiveRetentionRepository {
    return new ClickHouseRetroactiveRetentionRepository(options.clickhouse);
  }

  private constructor(private readonly clickhouse: ClickHouseQueryClient) {}

  async triggerUpdate(input: {
    projectId: string;
    category: RetentionCategory;
    newRetentionDays: number;
  }): Promise<{ tables: string[] }> {
    const categoryTables = Object.entries(RETENTION_TABLE_CATEGORY_MAP)
      .filter(([, category]) => category === input.category)
      .map(([table]) => table);
    // event_log is never table-classified: it is stamped per row instead
    // (`classifyEventLogRowRetention`), so every category's retroactive
    // update must also visit it, not only the category flatly mapping to it.
    const tables = [...new Set([...categoryTables, EVENT_LOG_TABLE])];

    const activeMutations = await this.getActiveMutations({
      projectId: input.projectId,
      tables,
      category: input.category,
    });

    if (activeMutations.length > 0) {
      throw new RetroactiveMutationInProgressError(activeMutations);
    }

    for (const table of tables) {
      // event_log carries rows from every category plus a durable,
      // never-expiring security slice. The extra predicate keeps this mutation
      // to the rows this category owns; the marker records which category ran
      // it so a concurrent mutation for another category is not mistaken for a
      // conflict.
      const eventLogCategoryFilter =
        table === EVENT_LOG_TABLE
          ? ` AND (${eventLogRetentionCategorySqlPredicate(input.category)})` +
            ` AND ${eventLogRetentionCategoryMutationMarkerSql(input.category)}`
          : "";

      await this.clickhouse.command({
        tenantId: input.projectId,
        table,
        kind: "write",
        sql:
          `ALTER TABLE ${table} ` +
          "UPDATE _retention_days = {retentionDays:UInt16} " +
          "WHERE TenantId = {tenantId:String} " +
          "AND _retention_days != {retentionDays:UInt16}" +
          eventLogCategoryFilter,
        params: {
          tenantId: input.projectId,
          retentionDays: input.newRetentionDays,
        },
      });
    }

    return { tables };
  }

  async findMutationProgress(input: { projectId: string }): Promise<RetroactiveMutationProgress[]> {
    const { rows } = await this.clickhouse.query<unknown>({
      tenantId: input.projectId,
      table: "system.mutations",
      kind: "read",
      sql: `
        SELECT
          mutation_id AS mutationId,
          table AS table,
          is_done AS isDone,
          parts_to_do AS partsToDo,
          formatDateTime(create_time, '%Y-%m-%dT%H:%i:%S') AS createTime,
          command AS command
        FROM system.mutations
        WHERE position(command, '_retention_days') > 0
          AND ${tenantFilterSql}
          AND is_done = 0
        ORDER BY create_time DESC
      `,
      params: tenantFilterParams(input.projectId),
      unscoped: {
        reason:
          "system.mutations carries no tenant column: the project is matched inside the recorded mutation command instead, which is what tenantFilterSql does.",
      },
    });

    return this.parseRows(rows);
  }

  async killMutation(input: { projectId: string; mutationId: string }): Promise<void> {
    await this.clickhouse.command({
      tenantId: input.projectId,
      table: "system.mutations",
      kind: "write",
      sql: "KILL MUTATION WHERE mutation_id = {mutationId:String} " + `AND ${tenantFilterSql}`,
      params: {
        mutationId: input.mutationId,
        ...tenantFilterParams(input.projectId),
      },
      unscoped: {
        reason:
          "KILL MUTATION reads system.mutations, which carries no tenant column: the project is matched inside the recorded mutation command instead, which is what tenantFilterSql does.",
      },
    });
  }

  private async getActiveMutations(input: {
    projectId: string;
    tables: string[];
    category: RetentionCategory;
  }): Promise<RetroactiveMutationProgress[]> {
    const { rows } = await this.clickhouse.query<unknown>({
      tenantId: input.projectId,
      table: "system.mutations",
      kind: "read",
      sql: `
        SELECT
          mutation_id AS mutationId,
          table AS table,
          is_done AS isDone,
          parts_to_do AS partsToDo,
          formatDateTime(create_time, '%Y-%m-%dT%H:%i:%S') AS createTime,
          command AS command
        FROM system.mutations
        WHERE table IN {tables:Array(String)}
          AND position(command, '_retention_days') > 0
          AND ${tenantFilterSql}
          AND is_done = 0
      `,
      params: { tables: input.tables, ...tenantFilterParams(input.projectId) },
      unscoped: {
        reason:
          "system.mutations carries no tenant column: the project is matched inside the recorded mutation command instead, which is what tenantFilterSql does.",
      },
    });

    return this.parseRows(rows, {
      // An event_log mutation marked for a different category touches a
      // disjoint set of rows (the SQL predicate guarantees it), so it is not
      // a real conflict and must not block this one. An unmarked legacy
      // mutation carries no such guarantee and still blocks every category.
      keepEventLogRow: (category) => category === null || category === input.category,
    });
  }

  private parseRows(
    rows: unknown,
    options?: { keepEventLogRow: (category: RetentionCategory | null) => boolean },
  ): RetroactiveMutationProgress[] {
    return mutationRowsSchema
      .parse(rows)
      .map(({ command, ...row }) => {
        const category = this.categoryForRow(row.table, command);
        return { row, category };
      })
      .filter(
        ({ row, category }) =>
          row.table !== EVENT_LOG_TABLE || !options || options.keepEventLogRow(category),
      )
      .map(({ row, category }) =>
        retroactiveMutationProgressSchema.parse({
          ...row,
          isDone: row.isDone === 1,
          category,
        }),
      );
  }

  /**
   * event_log's category is read off the marker its own mutation stamped,
   * since the table maps to "traces" flatly while its rows do not. A mutation
   * predating the marker falls back to "traces", blocking every category.
   */
  private categoryForRow(table: string, command: string | undefined): RetentionCategory | null {
    if (table === EVENT_LOG_TABLE) {
      return eventLogRetentionCategoryFromMutationCommand(command) ?? this.categoryForTable(table);
    }
    return this.categoryForTable(table);
  }

  private categoryForTable(table: string): RetentionCategory | null {
    return (
      Object.entries(RETENTION_TABLE_CATEGORY_MAP).find(([name]) => name === table)?.[1] ?? null
    );
  }
}
