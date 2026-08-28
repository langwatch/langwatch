import type { GatewayClickHouseClient } from "../../ports/gateway-clickhouse.port";
import {
  GatewayOpenAdmissionsPort,
  type OpenAdmission,
  type OpenAdmissionQuery,
} from "../../ports/gateway-open-admissions.port";
// The cap belongs to the sweep that reports on it, not to the query it
// bounds. One-way edge: the process imports nothing from here.
import { MAX_OPEN_ADMISSIONS_PER_SWEEP } from "../../processes/gateway-spend-settlement.process";

const TABLE_NAME = "gateway_spend" as const;

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
export class ClickHouseGatewayOpenAdmissionsRepository extends GatewayOpenAdmissionsPort {
  constructor(private readonly client: GatewayClickHouseClient) {
    super();
  }

  async findOpenAdmissions({
    now,
    graceMs,
    lookbackMs,
  }: OpenAdmissionQuery): Promise<OpenAdmission[]> {
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
