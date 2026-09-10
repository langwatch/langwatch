import {
  RetroactiveMutationInProgressError,
  retroactiveMutationProgressSchema,
  type RetentionCategory,
  type RetroactiveMutationProgress,
} from "@langwatch/data-retention-contract";
import { z } from "zod";
import { RETENTION_TABLE_CATEGORY_MAP } from "@langwatch/data-retention-contract/retention-tables";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { RetroactiveRetentionRepository } from "../retroactive-retention.repository.ts";

const mutationRowSchema = z
  .object({
    mutationId: z.string(),
    table: z.string(),
    isDone: z.number(),
    partsToDo: z.number(),
    createTime: z.string(),
  })
  .strict();

const tenantFilterSql = "position(command, {tenantFilterNeedle:String}) > 0";

function tenantFilterParams(projectId: string): Record<string, string> {
  const escapedProjectId = projectId.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return { tenantFilterNeedle: `WHERE TenantId = '${escapedProjectId}'` };
}

/**
 * Retention rewrites, over the process's one ClickHouse client.
 *
 * The client routes each statement to the server its tenant belongs on, so
 * this repository holds no per-tenant client and cannot obtain an unscoped
 * one: every call below names the project it acts for.
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
    const tables = Object.entries(RETENTION_TABLE_CATEGORY_MAP)
      .filter(([, category]) => category === input.category)
      .map(([table]) => table);
    const activeMutations = await this.getActiveMutations({
      projectId: input.projectId,
      tables,
    });

    if (activeMutations.length > 0) {
      throw new RetroactiveMutationInProgressError(activeMutations);
    }

    for (const table of tables) {
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

  async getMutationProgress(input: { projectId: string }): Promise<RetroactiveMutationProgress[]> {
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
          formatDateTime(create_time, '%Y-%m-%dT%H:%i:%S') AS createTime
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
          formatDateTime(create_time, '%Y-%m-%dT%H:%i:%S') AS createTime
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

    return this.parseRows(rows);
  }

  private parseRows(rows: unknown): RetroactiveMutationProgress[] {
    return z
      .array(mutationRowSchema)
      .parse(rows)
      .map((row) =>
        retroactiveMutationProgressSchema.parse({
          ...row,
          isDone: row.isDone === 1,
          category: this.categoryForTable(row.table),
        }),
      );
  }

  private categoryForTable(table: string): RetentionCategory | null {
    return (
      Object.entries(RETENTION_TABLE_CATEGORY_MAP).find(([name]) => name === table)?.[1] ?? null
    );
  }
}
