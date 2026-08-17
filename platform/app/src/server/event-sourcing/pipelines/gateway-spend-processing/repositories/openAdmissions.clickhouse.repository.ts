import type { ClickHouseClient } from "@clickhouse/client";
import { getAllClickHouseInstances } from "~/server/clickhouse/clickhouseClient";
// The cap belongs to the sweep that reports on it, not to the query it
// bounds. One-way edge: the process imports only TYPES from here, so this
// does not put the ClickHouse client on the process's module graph.
import { MAX_OPEN_ADMISSIONS_PER_SWEEP } from "../process-manager/spendSettlement.process";

const TABLE_NAME = "gateway_spend" as const;

/**
 * Read side of the settlement sweeper: admissions whose confirmation never
 * arrived, found by asking the spend record rather than by keeping a durable
 * timer per request.
 *
 * The fold already joins admission to outcome — that is what the projection
 * is — so the open admissions are simply the rows still sitting at
 * `admitted`. Reading them here is what lets settlement cost one process
 * instance for the whole install instead of one per gateway request.
 */

/**
 * An admission still waiting for its outcome, with the attribution the fold
 * recorded for it. The settle command carries this forward so a settled
 * webhook envelope names the organization and key the request belonged to
 * rather than arriving anonymous.
 */
export interface OpenAdmission {
  tenantId: string;
  gatewayRequestId: string;
  organizationId: string;
  virtualKeyId: string;
  principalUserId: string;
  endUserId: string;
  traceId: string;
  requestType: string;
  labels: string[];
  metadata: string;
  admittedAtMs: number;
  /** The identity the request ASKED for. A settlement resolved none of its
   *  own, and the settled envelope has always named the requested one. */
  model: string;
  providerKey: string;
}

export interface OpenAdmissionFinder {
  findOpenAdmissions(params: {
    now: number;
    graceMs: number;
    lookbackMs: number;
  }): Promise<OpenAdmission[]>;
}

/**
 * Finds every request still at `admitted` whose grace has elapsed, across
 * all tenants on one ClickHouse instance.
 *
 * Replacement-aware by the IN-tuple pattern the table's own migration
 * mandates: the fold writes one ReplacingMergeTree version per lifecycle
 * transition, so reading without collapsing to `max(EventTimestamp)` would
 * see a confirmed request's superseded `admitted` row and settle a request
 * that already resolved. Only key columns cross the subquery, so the scan
 * stays memory-bounded.
 *
 * Cross-tenant sweep BY DESIGN, so it omits the per-tenant `WHERE TenantId =`
 * filter clickhouse-queries.md mandates for tenant-scoped reads: settlement
 * is install-wide infrastructure with no single tenant to scope to. TenantId
 * is SELECTed rather than filtered, and every settle command downstream is
 * scoped to its own row's tenant — the same carve-out the stalled-run sweep
 * documents.
 */
export class ClickHouseOpenAdmissionFinder implements OpenAdmissionFinder {
  constructor(private readonly client: ClickHouseClient) {}

  async findOpenAdmissions({
    now,
    graceMs,
    lookbackMs,
  }: {
    now: number;
    graceMs: number;
    lookbackMs: number;
  }): Promise<OpenAdmission[]> {
    const openBeforeMs = now - graceMs;
    const fromMs = now - lookbackMs;

    const result = await this.client.query({
      query: `
        SELECT
          TenantId AS tenantId,
          GatewayRequestId AS gatewayRequestId,
          OrganizationId AS organizationId,
          VirtualKeyId AS virtualKeyId,
          PrincipalUserId AS principalUserId,
          EndUserId AS endUserId,
          TraceId AS traceId,
          RequestType AS requestType,
          Labels AS labels,
          Metadata AS metadata,
          Model AS model,
          ProviderKey AS providerKey,
          toUnixTimestamp64Milli(OccurredAt) AS admittedAtMs
        FROM ${TABLE_NAME}
        WHERE (TenantId, GatewayRequestId, EventTimestamp) IN (
            SELECT TenantId, GatewayRequestId, max(EventTimestamp)
            FROM ${TABLE_NAME}
            -- Repeated inside the subquery on purpose: the partition prune
            -- has to happen where the scan happens, not only on the outer
            -- filter, or the dedup reads every partition in retention.
            WHERE OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})
              AND OccurredAt < fromUnixTimestamp64Milli({openBeforeMs:Int64})
            GROUP BY TenantId, GatewayRequestId
          )
          AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})
          AND OccurredAt < fromUnixTimestamp64Milli({openBeforeMs:Int64})
          AND Status = 'admitted'
        ORDER BY OccurredAt ASC
        LIMIT {maxRows:UInt32}
      `,
      query_params: {
        fromMs,
        openBeforeMs,
        maxRows: MAX_OPEN_ADMISSIONS_PER_SWEEP,
      },
      format: "JSONEachRow",
    });

    return await result.json<OpenAdmission>();
  }
}

/**
 * One finder per configured ClickHouse instance (shared plus private orgs),
 * so a single sweeper settles every instance without holding a client.
 */
export async function getOpenAdmissionFindersByInstance(): Promise<
  Array<{ target: "shared" | string; finder: OpenAdmissionFinder }>
> {
  const instances = await getAllClickHouseInstances();
  return instances.map(({ target, client }) => ({
    target,
    finder: new ClickHouseOpenAdmissionFinder(client),
  }));
}
