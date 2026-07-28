// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * `AppendStore` adapter for the `governanceOcsfEvents` map projection
 * (ADR-075 Class C). Thin by design — the derivation lives in the
 * projection, the tenancy and insert shape live in the repository, and
 * this only bridges the two.
 *
 * No retention stamping: `governance_ocsf_events` carries no
 * `_retention_days` column (migration 00032 added them to the trace /
 * evaluation tables and deliberately not to the governance audit
 * stream), so there is nothing to pull off the store context.
 *
 * `bulkAppend` exists for replay: `replayMapProjection` rebuilds a window
 * event by event, and a per-row INSERT per span is how a rebuild turns
 * into a ClickHouse parts problem. The executor only batches within one
 * tenant, which is the tenancy boundary the repository asserts anyway.
 */

import type {
  GovernanceOcsfEventInput,
  GovernanceOcsfEventsClickHouseRepository,
} from "@ee/governance/services/governanceOcsfEvents.clickhouse.repository";
import type {
  AppendStore,
  BulkAppendContext,
} from "~/server/event-sourcing/projections/mapProjection.types";
import type { ProjectionStoreContext } from "~/server/event-sourcing/projections/projectionStoreContext";
import {
  assertRecordsTenant,
  assertRecordTenant,
} from "./assertRecordTenant";

const STORE_NAME = "GovernanceOcsfEventsAppendStore";

export class GovernanceOcsfEventsAppendStore
  implements AppendStore<GovernanceOcsfEventInput>
{
  constructor(
    private readonly repository: GovernanceOcsfEventsClickHouseRepository,
  ) {}

  async append(
    record: GovernanceOcsfEventInput,
    context: ProjectionStoreContext,
  ): Promise<void> {
    assertRecordTenant({
      store: STORE_NAME,
      recordTenantId: record.tenantId,
      contextTenantId: context.tenantId,
    });
    await this.repository.insertEvent(record);
  }

  async bulkAppend(
    records: GovernanceOcsfEventInput[],
    context: BulkAppendContext,
  ): Promise<void> {
    if (records.length === 0) return;
    assertRecordsTenant({
      store: STORE_NAME,
      records,
      contextTenantId: context.tenantId,
    });
    await this.repository.insertEvents(records);
  }
}
