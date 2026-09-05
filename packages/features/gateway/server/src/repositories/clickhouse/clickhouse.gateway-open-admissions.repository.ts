import type { GatewayClickHouseClient } from "../../ports/gateway-clickhouse.port";
import {
  GatewayOpenAdmissionsPort,
  type OpenAdmission,
  type OpenAdmissionQuery,
} from "../../ports/gateway-open-admissions.port";
// The cap belongs to the sweep that reports on it, not to the query it
// bounds. One-way edge: the intent imports nothing from here.
import { MAX_OPEN_ADMISSIONS_PER_SWEEP } from "../../intents/gateway-spend-settlement.intent";

const TABLE_NAME = "gateway_spend" as const;

/**
 * Every request still `admitted` whose grace has elapsed, across all tenants. Replacement-aware via the IN-tuple pattern (not max(EventTimestamp)) so a confirmed request's superseded `admitted` row is never re-settled; only key columns cross the subquery, keeping the scan memory-bounded. Cross-tenant BY DESIGN, so it omits the per-tenant WHERE TenantId= filter clickhouse-queries.md otherwise mandates — settlement is install-wide, TenantId is SELECTed not filtered, and every settle command downstream re-scopes to its own row's tenant.
 */
export class ClickHouseGatewayOpenAdmissionsRepository extends GatewayOpenAdmissionsPort {
  static create(client: GatewayClickHouseClient): ClickHouseGatewayOpenAdmissionsRepository {
    return new ClickHouseGatewayOpenAdmissionsRepository(client);
  }

  private constructor(private readonly client: GatewayClickHouseClient) {
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
      unscoped: {
        reason:
          "Install-wide settlement sweep: it finds every request left at admitted past its grace on this instance, and each settle it triggers is scoped to that row's own tenant.",
      },
    });

    return await result.json<OpenAdmission>();
  }
}
