import {
  RetroactiveMutationInProgressError,
  retroactiveMutationProgressSchema,
  type RetentionCategory,
  type RetroactiveMutationProgress,
} from "@langwatch/data-retention-contract";
import { z } from "zod";
import { RETENTION_TABLE_CATEGORY_MAP } from "../../adapters/clickhouse.retention-table.adapter";
import { RetroactiveRetentionRepository } from "../retroactive-retention.repository";

const mutationRowSchema = z
  .object({
    mutationId: z.string(),
    table: z.string(),
    isDone: z.number(),
    partsToDo: z.number(),
    createTime: z.string(),
  })
  .strict();

type QueryParams = Record<string, number | string | string[]>;

export type RetentionClickHouseClient = {
  command(input: { query: string; query_params: QueryParams }): Promise<void>;
  query(input: {
    query: string;
    query_params: QueryParams;
    format: "JSONEachRow";
  }): Promise<{ json(): Promise<unknown> }>;
};

export type RetentionClickHouseClientResolver = (
  projectId: string,
) => Promise<RetentionClickHouseClient>;

const tenantFilterSql = "position(command, {tenantFilterNeedle:String}) > 0";

function tenantFilterParams(projectId: string): Record<string, string> {
  const escapedProjectId = projectId.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return { tenantFilterNeedle: `WHERE TenantId = '${escapedProjectId}'` };
}

export class ClickHouseRetroactiveRetentionRepository extends RetroactiveRetentionRepository {
  static create(options: {
    resolveClient: RetentionClickHouseClientResolver;
  }): ClickHouseRetroactiveRetentionRepository {
    return new ClickHouseRetroactiveRetentionRepository(options.resolveClient);
  }

  private constructor(private readonly resolveClient: RetentionClickHouseClientResolver) {
    super();
  }

  async triggerUpdate(input: {
    projectId: string;
    category: RetentionCategory;
    newRetentionDays: number;
  }): Promise<{ tables: string[] }> {
    const tables = Object.entries(RETENTION_TABLE_CATEGORY_MAP)
      .filter(([, category]) => category === input.category)
      .map(([table]) => table);
    const client = await this.resolveClient(input.projectId);
    const activeMutations = await this.getActiveMutations({
      client,
      projectId: input.projectId,
      tables,
    });

    if (activeMutations.length > 0) {
      throw new RetroactiveMutationInProgressError(activeMutations);
    }

    for (const table of tables) {
      await client.command({
        query:
          `ALTER TABLE ${table} ` +
          "UPDATE _retention_days = {retentionDays:UInt16} " +
          "WHERE TenantId = {tenantId:String} " +
          "AND _retention_days != {retentionDays:UInt16}",
        query_params: {
          tenantId: input.projectId,
          retentionDays: input.newRetentionDays,
        },
      });
    }

    return { tables };
  }

  async getMutationProgress(input: {
    projectId: string;
  }): Promise<RetroactiveMutationProgress[]> {
    const client = await this.resolveClient(input.projectId);
    const result = await client.query({
      query: `
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
      query_params: tenantFilterParams(input.projectId),
      format: "JSONEachRow",
    });

    return this.parseRows(await result.json());
  }

  async killMutation(input: { projectId: string; mutationId: string }): Promise<void> {
    const client = await this.resolveClient(input.projectId);
    await client.command({
      query:
        "KILL MUTATION WHERE mutation_id = {mutationId:String} " +
        `AND ${tenantFilterSql}`,
      query_params: {
        mutationId: input.mutationId,
        ...tenantFilterParams(input.projectId),
      },
    });
  }

  private async getActiveMutations(input: {
    client: RetentionClickHouseClient;
    projectId: string;
    tables: string[];
  }): Promise<RetroactiveMutationProgress[]> {
    const result = await input.client.query({
      query: `
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
      query_params: { tables: input.tables, ...tenantFilterParams(input.projectId) },
      format: "JSONEachRow",
    });

    return this.parseRows(await result.json());
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
      Object.entries(RETENTION_TABLE_CATEGORY_MAP).find(
        ([name]) => name === table,
      )?.[1] ?? null
    );
  }
}
