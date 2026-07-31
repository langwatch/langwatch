import type {
  ClickHouseClientResolver,
  TenantClickHouseClient,
} from "~/server/app-layer/clients/clickhouse/tenant-client";
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
// needle is built in app code and passed as a query parameter — building it
// inside ClickHouse with concat() ran into double-vs-single-quote escaping
// (CH treats "..." as identifier names).
const TENANT_FILTER_SQL = "position(command, {tenantFilterNeedle:String}) > 0";

/** Metrics label for the `system.mutations` reads. */
const MUTATIONS_TABLE_LABEL = "system.mutations";

/** One `system.mutations` row, as the aliases in the SELECT name it. */
interface MutationRow {
  mutationId: string;
  table: string;
  isDone: number;
  partsToDo: number;
  createTime: string;
}

/**
 * Mirrors the way ClickHouse renders a string literal into
 * `system.mutations.command`: backslash and single-quote escapes. Without
 * this, project ids containing `'` or `\` would render escaped in CH's stored
 * command text and the unescaped JS-side needle would never match — so the
 * "do we already have a running mutation for this tenant?" check would
 * silently return empty, letting a second concurrent ALTER through.
 * CodeQL also flags the unescaped interpolation as incomplete encoding.
 */
function escapeClickHouseStringLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function tenantFilterParams(projectId: string): Record<string, string> {
  return {
    tenantFilterNeedle: `WHERE TenantId = '${escapeClickHouseStringLiteral(projectId)}'`,
  };
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
    // the retention value can — and must — flow through query parameters so we
    // don't reinvent string escaping for ClickHouse SQL.
    for (const table of tables) {
      await client.command({
        table,
        sql:
          `ALTER TABLE ${table} ` +
          `UPDATE _retention_days = {retentionDays:UInt16} ` +
          `WHERE TenantId = {tenantId:String} ` +
          `AND _retention_days != {retentionDays:UInt16}`,
        params: {
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
    const rows = await client.query<MutationRow>({
      table: MUTATIONS_TABLE_LABEL,
      sql: `
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
      params: tenantFilterParams(projectId),
    });

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
      table: MUTATIONS_TABLE_LABEL,
      sql:
        `KILL MUTATION WHERE mutation_id = {mutationId:String} ` +
        `AND ${TENANT_FILTER_SQL}`,
      params: { mutationId, ...tenantFilterParams(projectId) },
    });
  }

  private async getActiveMutations({
    client,
    projectId,
    tables,
  }: {
    client: TenantClickHouseClient;
    projectId: string;
    tables: string[];
  }): Promise<MutationProgress[]> {
    const rows = await client.query<MutationRow>({
      table: MUTATIONS_TABLE_LABEL,
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
          AND ${TENANT_FILTER_SQL}
          AND is_done = 0
      `,
      params: { tables, ...tenantFilterParams(projectId) },
    });

    return rows.map(this.toMutationProgress);
  }

  private toMutationProgress = (r: MutationRow): MutationProgress => ({
    mutationId: r.mutationId,
    table: r.table,
    isDone: r.isDone === 1,
    partsToDo: r.partsToDo,
    createTime: r.createTime,
    category:
      RETENTION_TABLE_CATEGORY_MAP[r.table as RetentionManagedTable] ?? null,
  });
}
