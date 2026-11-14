import { clickhouseRead, fn, tenantScope } from "@langwatch/clickhouse-client/builder";

import {
  GatewayOpenAdmissionsRepository,
  type OpenAdmission,
  type OpenAdmissionQuery,
} from "../../repositories/gateway-open-admissions.repository.ts";
import { MAX_OPEN_ADMISSIONS_PER_SWEEP } from "../../rules/gateway-spend-settlement.rules.ts";
import type { GatewayClickHouseClient } from "./clickhouse.gateway-session.store.ts";
import { gatewaySpend as spend } from "./clickhouse.gateway-spend.table.ts";

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

    // Install-wide settlement sweep: each settle it triggers is scoped to that row's own tenant.
    // The window repeats inside the election, so the partition prune happens where the scan does.
    const statement = clickhouseRead({
      scope: tenantScope.allTenants({ reason: "install-wide gateway settlement sweep" }),
    })
      .from(spend)
      .select({
        tenantId: spend.TenantId,
        gatewayRequestId: spend.GatewayRequestId,
        organizationId: spend.OrganizationId,
        virtualKeyId: spend.VirtualKeyId,
        principalUserId: spend.PrincipalUserId,
        endUserId: spend.EndUserId,
        traceId: spend.TraceId,
        requestType: spend.RequestType,
        labels: spend.Labels,
        metadata: spend.Metadata,
        model: spend.Model,
        providerKey: spend.ProviderKey,
        admittedAtMs: fn.toUnixTimestamp64Milli(spend.OccurredAt),
      })
      .where(({ and, gte, lt }) =>
        and(gte(spend.OccurredAt, fromMs), lt(spend.OccurredAt, openBeforeMs)),
      )
      .where(({ eq }) => eq(spend.Status, "admitted"), { inElection: false })
      .latestVersion()
      .orderBy(spend.OccurredAt, "ASC")
      .limit(MAX_OPEN_ADMISSIONS_PER_SWEEP)
      .build();
    const { rows } = await this.client.read({ statement });

    return rows as OpenAdmission[];
  }
}
