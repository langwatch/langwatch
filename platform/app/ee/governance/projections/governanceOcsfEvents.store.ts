// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * `AppendStore` adapter for the `governanceOcsfEvents` map. No retention
 * stamping: `governance_ocsf_events` carries no `_retention_days` column.
 */

import type {
  GovernanceOcsfEventInput,
  GovernanceOcsfEventsClickHouseRepository,
} from "@ee/governance/services/governanceOcsfEvents.clickhouse.repository";
import type { AppendStore, BatchContext } from "@langwatch/event-sourcing";
import { assertRecordsTenant } from "./assertRecordTenant";

const STORE_NAME = "GovernanceOcsfEventsAppendStore";

export function createGovernanceOcsfEventsStore(
  repository: GovernanceOcsfEventsClickHouseRepository,
): AppendStore<GovernanceOcsfEventInput> {
  return {
    kind: "append",
    async writeBatch(records, context: BatchContext) {
      if (records.length === 0) return;
      assertRecordsTenant({
        store: STORE_NAME,
        records,
        contextTenantId: context.tenantId,
      });
      await repository.insertEvents(records);
    },
  };
}
