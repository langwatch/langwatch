import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import {
  RetroactiveMutationInProgressError,
  retentionCategorySchema,
  retroactiveMutationProgressSchema,
  type RetentionCategory,
  type RetroactiveMutationProgress,
} from "@langwatch/data-retention-contract";
import { RETENTION_TABLE_CATEGORY_MAP } from "@langwatch/data-retention-contract/retention-tables";
import { EventLogRetention } from "@langwatch/eventing/server";
import { z } from "zod";

import { EVENT_LOG_RETENTION_CLASSIFICATION } from "../../rules/event-log-retention.rules.ts";
import {
  keepForeverRewriteSchema,
  type ClickHouseTarget,
  type KeepForeverRewrite,
  type RetroactiveRetentionRepository,
} from "../retroactive-retention.repository.ts";

const mutationRowSchema = z
  .object({
    mutationId: z.string(),
    table: z.string(),
    isDone: z.number(),
    // `parts_to_do` is Int64, which ClickHouse's JSON output sends as a string.
    partsToDo: z.coerce.number(),
    createTime: z.string(),
    // Selected only so eventing's rewrite can be read back for its category
    // marker; dropped before a row leaves this repository.
    command: z.string().optional(),
  })
  .strict();

const mutationRowsSchema = z.array(mutationRowSchema);

const keepForeverRowsSchema = z.array(
  z
    .object({
      mutationId: z.string(),
      isDone: z.number(),
      partsToDo: z.number(),
      latestFailReason: z.string(),
      table: z.string(),
      command: z.string(),
    })
    .transform(({ table, command, ...row }) => ({
      table,
      command,
      rewrite: { ...row, isDone: row.isDone === 1 },
    })),
);

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
    const eventLogRetention = EventLogRetention.create({
      client: options.clickhouse,
      classification: EVENT_LOG_RETENTION_CLASSIFICATION,
    });
    return new ClickHouseRetroactiveRetentionRepository(options.clickhouse, eventLogRetention);
  }

  private constructor(
    private readonly clickhouse: ClickHouseQueryClient,
    private readonly eventLogRetention: EventLogRetention,
  ) {}

  private isEventingTable(table: string): boolean {
    return this.eventLogRetention.tables.includes(table);
  }

  async triggerUpdate(input: {
    projectId: string;
    category: RetentionCategory;
    newRetentionDays: number;
  }): Promise<{ tables: string[] }> {
    const categoryTables = Object.entries(RETENTION_TABLE_CATEGORY_MAP)
      .filter(([, category]) => category === input.category)
      .map(([table]) => table);
    // Eventing's tables are classified per row, so every category visits them.
    const tables = [...new Set([...categoryTables, ...this.eventLogRetention.tables])];

    const activeMutations = await this.getActiveMutations({
      projectId: input.projectId,
      tables,
      category: input.category,
    });

    if (activeMutations.length > 0) {
      throw new RetroactiveMutationInProgressError(activeMutations);
    }

    for (const table of tables) {
      if (this.isEventingTable(table)) {
        await this.eventLogRetention.retainCategory({
          tenantId: input.projectId,
          category: input.category,
          retentionDays: input.newRetentionDays,
        });
        continue;
      }

      await this.clickhouse.command({
        tenantId: input.projectId,
        table,
        kind: "write",
        sql:
          `ALTER TABLE ${table} ` +
          "UPDATE _retention_days = {retentionDays:UInt16} " +
          "WHERE TenantId = {tenantId:String} " +
          "AND _retention_days != {retentionDays:UInt16}",
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
      // System.mutations carries no tenant column: the project is matched inside the recorded
      // mutation command instead, which is what tenantFilterSql does.
      SKIP_TENANT_CHECK: true,
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
      // KILL MUTATION reads system.mutations, which carries no tenant column: the project is
      // matched inside the recorded mutation command instead, which is what tenantFilterSql does.
      SKIP_TENANT_CHECK: true,
    });
  }

  keepForeverTargets(): readonly ClickHouseTarget[] {
    return [
      {},
      ...[...this.clickhouse.privateRoutes().keys()].map((organizationId) => ({ organizationId })),
    ];
  }

  async findKeepForeverRewrites(input: ClickHouseTarget): Promise<KeepForeverRewrite[]> {
    const { rows } = await this.clickhouse.query<unknown>({
      tenantId: "",
      ...input,
      table: "system.mutations",
      kind: "read",
      sql: `
        SELECT
          mutation_id AS mutationId,
          is_done AS isDone,
          toUInt32(parts_to_do) AS partsToDo,
          latest_fail_reason AS latestFailReason,
          table AS table,
          command AS command
        FROM system.mutations
        WHERE database = currentDatabase()
          AND table IN {tables:Array(String)}
          AND position(command, '_retention_days = 0') > 0
        ORDER BY create_time DESC
      `,
      params: { tables: this.eventLogRetention.tables },
      // The event log's keep-forever rewrite spans every tenant on a target, so its mutation does
      // too.
      SKIP_TENANT_CHECK: true,
    });
    return keepForeverRowsSchema
      .parse(rows)
      .filter(
        ({ table, command }) =>
          this.eventLogRetention.categoryOfMutation({ table, command }) ===
          EVENT_LOG_RETENTION_CLASSIFICATION.indefiniteClass,
      )
      .map(({ rewrite }) => keepForeverRewriteSchema.parse(rewrite));
  }

  async startKeepForeverRewrite(input: ClickHouseTarget): Promise<void> {
    await this.eventLogRetention.keepIndefiniteRows(input);
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
      // System.mutations carries no tenant column: the project is matched inside the recorded
      // mutation command instead, which is what tenantFilterSql does.
      SKIP_TENANT_CHECK: true,
    });

    return this.parseRows(rows, {
      // Another category's event-log rewrite touches disjoint rows; an
      // unmarked legacy rewrite reads as the table's flat category.
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
          !this.isEventingTable(row.table) || !options || options.keepEventLogRow(category),
      )
      .map(({ row, category }) =>
        retroactiveMutationProgressSchema.parse({
          ...row,
          isDone: row.isDone === 1,
          category,
        }),
      );
  }

  /** An eventing rewrite's category is its marker's; an unmarked one falls back to the table's. */
  private categoryForRow(table: string, command: string | undefined): RetentionCategory | null {
    const marked = this.eventLogRetention.categoryOfMutation({ table, command });
    const category = retentionCategorySchema.safeParse(marked);
    return category.success ? category.data : this.categoryForTable(table);
  }

  private categoryForTable(table: string): RetentionCategory | null {
    return (
      Object.entries(RETENTION_TABLE_CATEGORY_MAP).find(([name]) => name === table)?.[1] ?? null
    );
  }
}
