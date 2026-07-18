import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { incrementEsFoldConfirmationReplicasMissing } from "~/server/metrics";
import { SecurityError } from "../../services/errorHandling";
import type { FoldDurabilityProbe } from "./durabilityProbe";

export interface ClickHouseDurabilityProbeDeps {
  resolveClient: ClickHouseClientResolver;
  /** Fold table, unqualified — the client's connection supplies the database. */
  table: string;
  /** Column holding the aggregate id, e.g. `TraceId`. */
  idColumn: string;
  /**
   * Cluster name, from `CLICKHOUSE_CLUSTER`. When absent the table is not
   * replicated and a plain read is by definition what every replica holds.
   */
  cluster?: string;
  /** Metric label. Defaults to the table name. */
  projectionName?: string;
}

interface ReplicatedRow {
  aggregateId: string;
  slowest: string | number | null;
  hostsWithRow: string | number;
  hostsTotal: string | number;
}

interface SingleNodeRow {
  aggregateId: string;
  updatedAt: string | number | null;
}

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Reports how far the least-caught-up replica has advanced for each aggregate.
 *
 * Releasing a cached fold entry on the strength of one replica's answer would
 * be worse than not checking at all: reads are load-balanced, so the next read
 * could land on a replica that never received the row. Hence `min` across
 * replicas rather than `max`, and hence the host-count guard — a replica that
 * is missing the row contributes no group at all, so without counting hosts an
 * absent row is indistinguishable from consensus.
 *
 * The query fans out to every replica, which is affordable because it is
 * batched, keyed on the primary key, and runs on a periodic job rather than in
 * the fold path. Establishing the same guarantee synchronously was measured and
 * reverted — #2751 (~200ms per fold step) and #2899 (10-14s reads).
 *
 * `UpdatedAt` is `DateTime64(3)` on every fold table, so it MUST be read
 * through `toUnixTimestamp64Milli`: a raw `max(UpdatedAt)` serialises as a
 * datetime string, which parses to NaN and silently reports every aggregate
 * as unconfirmable. The cached value it is compared against is epoch ms.
 */
export class ClickHouseDurabilityProbe implements FoldDurabilityProbe {
  private readonly projectionName: string;

  constructor(private readonly deps: ClickHouseDurabilityProbeDeps) {
    this.projectionName = deps.projectionName ?? deps.table;
  }

  async confirmedUpdatedAt({
    tenantId,
    aggregateIds,
  }: {
    tenantId: string;
    aggregateIds: readonly string[];
  }): Promise<Map<string, number>> {
    if (aggregateIds.length === 0) return new Map();

    // No aggregate id in this system is unique across tenants — trace ids,
    // run ids and scenario ids all repeat — so an unscoped read here would
    // confirm one tenant's cache entry against another tenant's row and
    // release state that was never durable. Refusing outright beats emitting
    // a query whose only tenant scoping is a string the caller assembled.
    if (!tenantId) {
      throw new SecurityError(
        "foldCache.confirmDurability",
        "Durability confirmation attempted without a tenantId — aggregate ids are not unique across tenants, so an unscoped check could confirm against another tenant's row and release cached state that was never durable",
        tenantId,
        { table: this.deps.table, aggregateCount: aggregateIds.length },
      );
    }

    return this.deps.cluster
      ? await this.queryReplicated({ tenantId, aggregateIds })
      : await this.querySingleNode({ tenantId, aggregateIds });
  }

  private async queryReplicated({
    tenantId,
    aggregateIds,
  }: {
    tenantId: string;
    aggregateIds: readonly string[];
  }): Promise<Map<string, number>> {
    const client = await this.deps.resolveClient(tenantId);

    // `hostsTotal` counts the replicas that answered at all. An unreachable
    // replica makes clusterAllReplicas raise rather than silently return a
    // subset, so a successful query means every replica is represented — and
    // an aggregate is only confirmed when it was found on all of them.
    const result = await client.query({
      query: `
        SELECT
          aggregateId,
          min(latest) AS slowest,
          uniqExact(host) AS hostsWithRow,
          (
            SELECT uniqExact(hostName())
            FROM clusterAllReplicas({cluster:Identifier}, system, one)
          ) AS hostsTotal
        FROM (
          SELECT
            ${this.deps.idColumn} AS aggregateId,
            hostName() AS host,
            toUnixTimestamp64Milli(max(UpdatedAt)) AS latest
          FROM clusterAllReplicas({cluster:Identifier}, currentDatabase(), ${this.deps.table})
          WHERE TenantId = {tenantId:String}
            AND ${this.deps.idColumn} IN {aggregateIds:Array(String)}
          GROUP BY aggregateId, host
        )
        GROUP BY aggregateId
      `,
      query_params: {
        cluster: this.deps.cluster,
        tenantId,
        aggregateIds: [...aggregateIds],
      },
      // The host-count guard below only means anything if an unreachable
      // replica FAILS the query rather than being silently omitted — a skipped
      // replica would make hostsWithRow == hostsTotal and release an entry the
      // recovered node does not yet hold.
      clickhouse_settings: { skip_unavailable_shards: 0 },
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as ReplicatedRow[];
    const confirmed = new Map<string, number>();
    let missing = 0;

    for (const row of rows) {
      const slowest = toNumber(row.slowest);
      const hostsWithRow = toNumber(row.hostsWithRow);
      const hostsTotal = toNumber(row.hostsTotal);

      if (slowest === null || hostsWithRow === null || hostsTotal === null) {
        continue;
      }
      if (hostsWithRow < hostsTotal) {
        // Present on some replicas but not all — not confirmed. Counted so a
        // node that is down or removed is distinguishable from ordinary lag.
        missing += 1;
        continue;
      }
      confirmed.set(row.aggregateId, slowest);
    }

    if (missing > 0) {
      incrementEsFoldConfirmationReplicasMissing(this.projectionName, missing);
    }

    return confirmed;
  }

  private async querySingleNode({
    tenantId,
    aggregateIds,
  }: {
    tenantId: string;
    aggregateIds: readonly string[];
  }): Promise<Map<string, number>> {
    const client = await this.deps.resolveClient(tenantId);

    const result = await client.query({
      query: `
        SELECT
          ${this.deps.idColumn} AS aggregateId,
          toUnixTimestamp64Milli(max(UpdatedAt)) AS updatedAt
        FROM ${this.deps.table}
        WHERE TenantId = {tenantId:String}
          AND ${this.deps.idColumn} IN {aggregateIds:Array(String)}
        GROUP BY aggregateId
      `,
      query_params: { tenantId, aggregateIds: [...aggregateIds] },
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as SingleNodeRow[];
    const confirmed = new Map<string, number>();

    for (const row of rows) {
      const updatedAt = toNumber(row.updatedAt);
      if (updatedAt !== null) confirmed.set(row.aggregateId, updatedAt);
    }

    return confirmed;
  }
}
