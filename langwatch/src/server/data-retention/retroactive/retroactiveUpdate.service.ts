import type { ClickHouseClient } from "@clickhouse/client";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { createLogger } from "~/utils/logger/server";
import {
  RETENTION_TABLE_CATEGORY_MAP,
  type RetentionCategory,
} from "../retentionPolicy.schema";

const logger = createLogger("langwatch:data-retention:retroactive");

interface MutationProgress {
  mutationId: string;
  table: string;
  isDone: boolean;
  partsToDo: number;
  partsDone: number;
  createTime: string;
}

interface TriggerRetroactiveUpdateParams {
  projectId: string;
  category: RetentionCategory;
  newRetentionDays: number;
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
      const blocked = activeMutations.map((m) => m.table).join(", ");
      throw new Error(
        `Retroactive update already in progress for: ${blocked}. Wait for completion before starting another.`,
      );
    }

    for (const table of tables) {
      await client.command({
        query: `ALTER TABLE ${table} UPDATE _retention_days = ${newRetentionDays} WHERE TenantId = '${projectId}' AND _retention_days != ${newRetentionDays} AND _retention_days != 0`,
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
        WHERE command LIKE '%_retention_days%'
          AND command LIKE '%${projectId}%'
          AND is_done = 0
        ORDER BY create_time DESC
      `,
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as Array<{
      mutationId: string;
      table: string;
      isDone: number;
      partsToDo: number;
      createTime: string;
    }>;

    return rows.map((r) => ({
      mutationId: r.mutationId,
      table: r.table,
      isDone: r.isDone === 1,
      partsToDo: r.partsToDo,
      partsDone: 0,
      createTime: r.createTime,
    }));
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
      query: `KILL MUTATION WHERE mutation_id = '${mutationId.replace(/'/g, "\\'")}'`,
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
    const tableList = tables.map((t) => `'${t}'`).join(",");
    const result = await client.query({
      query: `
        SELECT
          mutation_id AS mutationId,
          table AS table,
          is_done AS isDone,
          parts_to_do AS partsToDo,
          formatDateTime(create_time, '%Y-%m-%dT%H:%i:%S') AS createTime
        FROM system.mutations
        WHERE table IN (${tableList})
          AND command LIKE '%_retention_days%'
          AND command LIKE '%${projectId}%'
          AND is_done = 0
      `,
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as Array<{
      mutationId: string;
      table: string;
      isDone: number;
      partsToDo: number;
      createTime: string;
    }>;

    return rows.map((r) => ({
      mutationId: r.mutationId,
      table: r.table,
      isDone: r.isDone === 1,
      partsToDo: r.partsToDo,
      partsDone: 0,
      createTime: r.createTime,
    }));
  }
}
