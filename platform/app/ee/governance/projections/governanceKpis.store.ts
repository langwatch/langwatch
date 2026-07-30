// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * `AppendStore` adapter for the `governanceKpis` map projection
 * (ADR-075 Class C). Mirrors the OCSF store: the derivation lives in the
 * projection, the insert shape in the repository, and this only bridges
 * them.
 *
 * `governance_kpis` carries no `_retention_days` column, so there is no
 * retention to stamp. `bulkAppend` keeps a replay from issuing one INSERT
 * per span.
 */

import type {
  GovernanceKpiContribution,
  GovernanceKpisClickHouseRepository,
} from "@ee/governance/services/governanceKpis.clickhouse.repository";
import type {
  AppendStore,
  BulkAppendContext,
} from "~/server/event-sourcing.old/projections/mapProjection.types";
import type { ProjectionStoreContext } from "~/server/event-sourcing.old/projections/projectionStoreContext";
import {
  assertRecordsTenant,
  assertRecordTenant,
} from "./assertRecordTenant";

const STORE_NAME = "GovernanceKpisAppendStore";

export class GovernanceKpisAppendStore
  implements AppendStore<GovernanceKpiContribution>
{
  constructor(
    private readonly repository: GovernanceKpisClickHouseRepository,
  ) {}

  async append(
    record: GovernanceKpiContribution,
    context: ProjectionStoreContext,
  ): Promise<void> {
    assertRecordTenant({
      store: STORE_NAME,
      recordTenantId: record.tenantId,
      contextTenantId: context.tenantId,
    });
    await this.repository.insertContribution(record);
  }

  async bulkAppend(
    records: GovernanceKpiContribution[],
    context: BulkAppendContext,
  ): Promise<void> {
    if (records.length === 0) return;
    assertRecordsTenant({
      store: STORE_NAME,
      records,
      contextTenantId: context.tenantId,
    });
    await this.repository.insertContributions(records);
  }
}
