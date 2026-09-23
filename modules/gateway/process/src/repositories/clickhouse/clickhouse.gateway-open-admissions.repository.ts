import type { GatewayClickHouseClient } from "../../app/gateway.members.ts";
import {
  GatewayOpenAdmissionsRepository,
  type OpenAdmission,
  type OpenAdmissionQuery,
} from "../../repositories/gateway-open-admissions.repository.ts";
import { MAX_OPEN_ADMISSIONS_PER_SWEEP } from "../../rules/gateway-spend-settlement.rules.ts";

const TABLE_NAME = "gateway_spend" as const;

/**
 * Every request still `admitted` whose grace elapsed, across all tenants —
 * cross-tenant BY DESIGN: settlement is install-wide, so this omits the
 * mandatory per-tenant TenantId filter; each settle command re-scopes itself.
 */
export class ClickHouseGatewayOpenAdmissionsRepository extends GatewayOpenAdmissionsRepository {
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

    return result.json<OpenAdmission>();
  }
}
