import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { ClickHouseServerHealth } from "@langwatch/ops-contract";
import { CLICKHOUSE_QUERY_ERROR_MAX_PROJECTS } from "@langwatch/ops-contract";

import { querySourceExpression } from "../../rules/clickhouse-query-source.rules.ts";
import { isPlainClusterName, isUnknownClusterError } from "../../rules/cluster-name.rules.ts";
import {
  ClickHouseServerRepository,
  type ClickHouseQueryErrorRow,
} from "../clickhouse.server.repository.ts";

/** The most groups one read answers: a window with more is a fire, read a narrower one. */
const MAX_ERROR_GROUPS = 10_000;

type Row = Record<string, unknown>;

/**
 * The shared endpoint's system tables, read unscoped (`tenantId: ""`): none carries a tenant
 * column, and every read is limited to the app's own database. Never a statement's text.
 */
export class ClickHouseClickHouseServerRepository extends ClickHouseServerRepository {
  private constructor(private readonly clickhouse: ClickHouseQueryClient) {
    super();
  }

  static create({
    clickhouse,
  }: {
    clickhouse: ClickHouseQueryClient;
  }): ClickHouseClickHouseServerRepository {
    return new ClickHouseClickHouseServerRepository(clickhouse);
  }

  async findQueryErrors({
    sinceMs,
    untilMs,
    code,
    source,
    cluster,
  }: {
    sinceMs: number;
    untilMs: number;
    code?: number | undefined;
    source?: string | undefined;
    cluster?: string | undefined;
  }): Promise<ClickHouseQueryErrorRow[]> {
    return this.orLocal({
      cluster,
      read: async (target) => {
        if (!(await this.hasQueryLog({ cluster: target }))) return [];
        const rows = await this.read({
          cluster: target,
          sql: `
            SELECT
              toString(normalized_query_hash) AS query_shape_id,
              ${querySourceExpression()} AS source,
              exception_code AS code,
              toString(errorCodeToName(exception_code)) AS code_name,
              count() AS failures,
              quantile(0.95)(query_duration_ms) AS p95_ms,
              max(memory_usage) AS max_memory,
              sum(read_rows) AS rows_read,
              groupUniqArrayArray(${CLICKHOUSE_QUERY_ERROR_MAX_PROJECTS})(arrayFilter(id -> id != '',
                splitByChar(',', extract(log_comment, '^lwql:project=([A-Za-z0-9_,-]*)$')))) AS project_ids,
              toUnixTimestamp64Milli(max(event_time_microseconds)) AS last_at
            FROM ${systemTable({ cluster: target, table: "query_log" })}
            WHERE event_date >= toDate(fromUnixTimestamp64Milli({sinceMs:Int64}))
              AND event_time_microseconds >= fromUnixTimestamp64Milli({sinceMs:Int64})
              AND event_time_microseconds < fromUnixTimestamp64Milli({untilMs:Int64})
              AND type IN ('ExceptionBeforeStart', 'ExceptionWhileProcessing')
              AND current_database = currentDatabase()
              ${code === undefined ? "" : "AND exception_code = {code:Int32}"}
            GROUP BY query_shape_id, source, code, code_name
            ${source === undefined ? "" : "HAVING source = {source:String}"}
            ORDER BY failures DESC, query_shape_id
            LIMIT ${MAX_ERROR_GROUPS}
          `,
          params: {
            sinceMs,
            untilMs,
            ...(code === undefined ? {} : { code }),
            ...(source === undefined ? {} : { source }),
          },
        });
        return rows.map((row) => ({
          queryShapeId: textOf(row.query_shape_id),
          source: textOf(row.source),
          code: numberOf(row.code),
          codeName: textOf(row.code_name),
          count: numberOf(row.failures),
          p95Ms: numberOf(row.p95_ms),
          maxMemoryBytes: Math.max(0, numberOf(row.max_memory)),
          rowsRead: numberOf(row.rows_read),
          projectIds: Array.isArray(row.project_ids) ? row.project_ids.map(String) : [],
          lastAt: numberOf(row.last_at),
        }));
      },
    });
  }

  async findHealth({ cluster }: { cluster?: string | undefined }): Promise<ClickHouseServerHealth> {
    return this.orLocal({ cluster, read: (target) => this.readHealth({ cluster: target }) });
  }

  private async readHealth({
    cluster,
  }: {
    cluster: string | undefined;
  }): Promise<ClickHouseServerHealth> {
    const [memory, replicas, merges, mutations, disks, tables] = await Promise.all([
      this.read({
        cluster,
        sql: `SELECT uniqExact(hostName()) AS nodes,
          maxIf(value, metric = 'MemoryResident') AS resident,
          maxIf(value, metric = 'OSMemoryTotal') AS total
        FROM ${systemTable({ cluster, table: "asynchronous_metrics" })}
        WHERE metric IN ('MemoryResident', 'OSMemoryTotal')`,
      }).then(firstRow),
      this.read({
        cluster,
        sql: `SELECT count() AS tables, countIf(is_readonly) AS readonly,
          countIf(is_session_expired) AS expired, max(absolute_delay) AS max_delay,
          max(queue_size) AS max_queue
        FROM ${systemTable({ cluster, table: "replicas" })} WHERE database = currentDatabase()`,
      }).then(firstRow),
      this.read({
        cluster,
        sql: `SELECT count() AS running, max(elapsed) AS longest
        FROM ${systemTable({ cluster, table: "merges" })} WHERE database = currentDatabase()`,
      }).then(firstRow),
      this.read({
        cluster,
        sql: `SELECT uniqExact(table, mutation_id) AS pending
        FROM ${systemTable({ cluster, table: "mutations" })} WHERE database = currentDatabase() AND is_done = 0`,
      }).then(firstRow),
      this.read({
        cluster,
        sql: `SELECT count() AS disks, sum(total_space) AS total, sum(free_space) AS free,
          min(if(total_space = 0, 1, free_space / total_space)) AS lowest
        FROM ${systemTable({ cluster, table: "disks" })}`,
      }).then(firstRow),
      this.read({
        cluster,
        sql: `
          SELECT table, max(node_parts) AS active_parts, max(node_max) AS max_in_partition,
            max(node_bytes) AS bytes
          FROM (
            SELECT node, table, sum(parts) AS node_parts, max(parts) AS node_max,
              sum(bytes) AS node_bytes
            FROM (
              SELECT hostName() AS node, table, partition_id, count() AS parts,
                sum(bytes_on_disk) AS bytes
              FROM ${systemTable({ cluster, table: "parts" })}
              WHERE database = currentDatabase() AND active
              GROUP BY node, table, partition_id
            )
            GROUP BY node, table
          )
          GROUP BY table
          ORDER BY table
        `,
      }),
    ]);
    const diskCount = numberOf(disks.disks);
    return {
      nodes: numberOf(memory.nodes),
      replicas: {
        tables: numberOf(replicas.tables),
        readonly: numberOf(replicas.readonly),
        sessionExpired: numberOf(replicas.expired),
        maxDelaySeconds: numberOf(replicas.max_delay),
        maxQueueSize: numberOf(replicas.max_queue),
      },
      merges: {
        running: numberOf(merges.running),
        longestSeconds: numberOf(merges.longest),
        pendingMutations: numberOf(mutations.pending),
      },
      disks: {
        count: diskCount,
        totalBytes: numberOf(disks.total),
        freeBytes: numberOf(disks.free),
        lowestFreeRatio: diskCount === 0 ? 1 : Math.min(1, Math.max(0, numberOf(disks.lowest))),
      },
      memory: { residentBytes: numberOf(memory.resident), totalBytes: numberOf(memory.total) },
      tables: tables.map((row) => ({
        table: textOf(row.table),
        activeParts: numberOf(row.active_parts),
        maxPartsInPartition: numberOf(row.max_in_partition),
        bytesOnDisk: numberOf(row.bytes),
      })),
    };
  }

  /** Asked first: a server that logs no queries has no `system.query_log` table. */
  private async hasQueryLog({ cluster }: { cluster: string | undefined }): Promise<boolean> {
    const [row] = await this.read({
      cluster,
      sql: `SELECT count() AS present FROM ${systemTable({ cluster, table: "tables" })}
        WHERE database = 'system' AND name = 'query_log'`,
    });
    return numberOf(row?.present) > 0;
  }

  private async read({
    cluster,
    sql,
    params,
  }: {
    cluster: string | undefined;
    sql: string;
    params?: Record<string, unknown>;
  }): Promise<Row[]> {
    const result = await this.clickhouse.query<Row>({
      tenantId: "",
      sql,
      ...(params === undefined ? {} : { params }),
      settings: clusterSettings(cluster),
      // System tables carry no tenant column: these are the server's own log and health.
      SKIP_TENANT_CHECK: true,
    });
    return result.rows;
  }

  /** Across the cluster, or on the local node when ClickHouse does not know the cluster. */
  private async orLocal<T>({
    cluster,
    read,
  }: {
    cluster: string | undefined;
    read: (cluster: string | undefined) => Promise<T>;
  }): Promise<T> {
    const name = plainClusterName(cluster);
    if (!name) return read(void 0);
    try {
      return await read(name);
    } catch (error) {
      if (!isUnknownClusterError(error)) throw error;
      return read(void 0);
    }
  }
}

function firstRow(rows: Row[]): Row {
  return rows[0] ?? {};
}

function textOf(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function numberOf(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** The trusted cluster name, or an empty string where none is named or it is not plain. */
function plainClusterName(cluster: string | undefined): string {
  const name = cluster?.trim() ?? "";
  return isPlainClusterName(name) ? name : "";
}

function systemTable({ cluster, table }: { cluster: string | undefined; table: string }): string {
  const name = plainClusterName(cluster);
  return name ? `clusterAllReplicas('${name}', system.${table})` : `system.${table}`;
}

/** One unreachable replica must not blank the reading the others can still answer. */
function clusterSettings(cluster: string | undefined): Record<string, number> {
  return plainClusterName(cluster) ? { skip_unavailable_shards: 1 } : {};
}
