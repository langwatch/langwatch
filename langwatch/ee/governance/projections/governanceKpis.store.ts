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
} from "~/server/event-sourcing/projections/mapProjection.types";
import type { ProjectionStoreContext } from "~/server/event-sourcing/projections/projectionStoreContext";

export class GovernanceKpisAppendStore
  implements AppendStore<GovernanceKpiContribution>
{
  constructor(
    private readonly repository: GovernanceKpisClickHouseRepository,
  ) {}

  async append(
    record: GovernanceKpiContribution,
    _context: ProjectionStoreContext,
  ): Promise<void> {
    await this.repository.insertContribution(record);
  }

  async bulkAppend(
    records: GovernanceKpiContribution[],
    _context: BulkAppendContext,
  ): Promise<void> {
    if (records.length === 0) return;
    await this.repository.insertContributions(records);
  }
}
