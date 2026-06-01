import type { ClickHouseClient } from "@clickhouse/client";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import {
  RETENTION_TABLE_CATEGORY_MAP,
  type RetentionCategory,
  type RetentionManagedTable,
} from "../retentionPolicy.schema";

export interface MutationProgress {
  mutationId: string;
  table: string;
  isDone: boolean;
  // Parts still pending for this mutation. ClickHouse's system.mutations
  // exposes only the remaining count (parts_to_do), not a total or done
  // count, so progress is shown as "N parts remaining" counting down to 0.
  partsToDo: number;
  createTime: string;
  category: RetentionCategory | null;
}

interface TriggerRetroactiveUpdateParams {
  projectId: string;
  category: RetentionCategory;
  newRetentionDays: number;
}

export class RetroactiveMutationInProgressError extends Error {
  readonly name = "RetroactiveMutationInProgressError" as const;
  constructor(public readonly blocked: MutationProgress[]) {
    const summary = blocked
      .map((m) => `${m.table} (${m.mutationId})`)
      .join(", ");
    super(
      `Retroactive update already in progress for: ${summary}. ` +
        `Wait for completion or kill the listed mutation(s) before starting another.`,
    );
  }
}

// Mutation filter: substring-match the WHERE TenantId clause inside
// system.mutations.command so we only see mutations for this tenant.
// Using position() instead of LIKE avoids `_` / `%` matching weirdness for
// project ids that contain underscores (e.g. "project_xyz"). The search
// needle is built in app code and passed via query_params — building it
// inside ClickHouse with concat() ran into double-vs-single-quote escaping
// (CH treats "..." as identifier names).
const TENANT_FILTER_SQL =
  "position(command, {tenantFilterNeedle:String}) > 0";

function tenantFilterParams(projectId: string): Record<string, string> {
  return { tenantFilterNeedle: `WHERE TenantId = '${projectId}'` };
}

export class RetroactiveUpdateService {
  constructor(
    private readonly resolveClickHouseClient: ClickHouseClientResolver | null,
  ) {}

  async triggerUpdate({
    projectId,
    category,
    newRetentionDays,
  }: TriggerRetroactiveUpdateParams): Promise<{ tables: string[] }> {
    if (!this.resolveClickHouseClient) {
      throw new Error("ClickHouse not available");
    }

    const tables = Object.entries(RETENTION_TABLE_CATEGORY_MAP)
      .filter(([, cat]) => cat === category)
      .map(([table]) => table);

    const client = await this.resolveClickHouseClient(projectId);

    const activeMutations = await this.getActiveMutations({
      client,
      projectId,
      tables,
    });
    if (activeMutations.length > 0) {
      throw new RetroactiveMutationInProgressError(activeMutations);
    }

    // ALTER TABLE cannot parametrize the table identifier, but the tenant and
    // the retention value can — and must — flow through query_params so we
    // don't reinvent string escaping for ClickHouse SQL.
    for (const table of tables) {
      await client.command({
        query:
          `ALTER TABLE ${table} ` +
          `UPDATE _retention_days = {retentionDays:UInt16} ` +
          `WHERE TenantId = {tenantId:String} ` +
          `AND _retention_days != {retentionDays:UInt16}`,
        query_params: {
          tenantId: projectId,
          retentionDays: newRetentionDays,
        },
      });
    }

    return { tables };
  }

  async getMutationProgress({
    projectId,
  }: {
    projectId: string;
  }): Promise<MutationProgress[]> {
    if (!this.resolveClickHouseClient) return [];

    const client = await this.resolveClickHouseClient(projectId);
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
          AND ${TENANT_FILTER_SQL}
          AND is_done = 0
        ORDER BY create_time DESC
      `,
      query_params: tenantFilterParams(projectId),
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as Array<{
      mutationId: string;
      table: string;
      isDone: number;
      partsToDo: number;
      createTime: string;
    }>;

    return rows.map(this.toMutationProgress);
  }

  async killMutation({
    projectId,
    mutationId,
  }: {
    projectId: string;
    mutationId: string;
  }): Promise<void> {
    if (!this.resolveClickHouseClient) return;

    const client = await this.resolveClickHouseClient(projectId);
    await client.command({
      query:
        `KILL MUTATION WHERE mutation_id = {mutationId:String} ` +
        `AND ${TENANT_FILTER_SQL}`,
      query_params: { mutationId, ...tenantFilterParams(projectId) },
    });
  }

  private async getActiveMutations({
    client,
    projectId,
    tables,
  }: {
    client: ClickHouseClient;
    projectId: string;
    tables: string[];
  }): Promise<MutationProgress[]> {
    const result = await client.query({
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
          AND ${TENANT_FILTER_SQL}
          AND is_done = 0
      `,
      query_params: { tables, ...tenantFilterParams(projectId) },
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as Array<{
      mutationId: string;
      table: string;
      isDone: number;
      partsToDo: number;
      createTime: string;
    }>;

    return rows.map(this.toMutationProgress);
  }

  private toMutationProgress = (r: {
    mutationId: string;
    table: string;
    isDone: number;
    partsToDo: number;
    createTime: string;
  }): MutationProgress => ({
    mutationId: r.mutationId,
    table: r.table,
    isDone: r.isDone === 1,
    partsToDo: r.partsToDo,
    createTime: r.createTime,
    category:
      RETENTION_TABLE_CATEGORY_MAP[r.table as RetentionManagedTable] ?? null,
  });
}
