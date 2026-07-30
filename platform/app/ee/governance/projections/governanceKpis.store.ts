// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * `AppendStore` adapter for the `governanceKpis` map. `governance_kpis` carries
 * no `_retention_days` column, so there is no retention to stamp.
 */

import type {
  GovernanceKpiContribution,
  GovernanceKpisClickHouseRepository,
} from "@ee/governance/services/governanceKpis.clickhouse.repository";
import type { AppendStore, BatchContext } from "@langwatch/event-sourcing";
import { assertRecordsTenant } from "./assertRecordTenant";

const STORE_NAME = "GovernanceKpisAppendStore";

export function createGovernanceKpisStore(
  repository: GovernanceKpisClickHouseRepository,
): AppendStore<GovernanceKpiContribution> {
  return {
    kind: "append",
    async writeBatch(records, context: BatchContext) {
      if (records.length === 0) return;
      assertRecordsTenant({
        store: STORE_NAME,
        records,
        contextTenantId: context.tenantId,
      });
      await repository.insertContributions(records);
    },
  };
}
