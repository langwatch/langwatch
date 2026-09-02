// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The ClickHouse half of a governance erasure (ADR-128 §9 step 4).
 *
 * `RawActorId` leads nothing but it is IN the rollup's sorting key, and
 * ClickHouse refuses a mutation on a sorting-key column: the key is the row's
 * identity, so a changed key is a different row rather than an edited one, and
 * the engine will not pretend otherwise. Verified against ClickHouse 26.2.1 —
 * `ALTER TABLE ... UPDATE RawActorId` returns `Code: 420
 * CANNOT_UPDATE_COLUMN`.
 *
 * So erasure is delete-then-replay: find the days carrying the identifier,
 * delete the rows, replay those days so the fold re-derives them with the
 * pseudonym in place (`actorIdForRollupWrite`). Days older than the event log's
 * retention have nothing left to replay from, which is why this class reports
 * which days it deleted — the caller records the ones it could not rebuild
 * rather than pretending the totals are unchanged.
 *
 * Spec: specs/governance/governance-identity-and-erasure.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { createLogger } from "@langwatch/observability";

import { GOVERNANCE_COST_ROLLUP_TABLE } from "../projections/governanceCostRollup.constants";

const logger = createLogger("langwatch:governance:rollup-erasure");

/** One `(tenant, day)` the erased identifier was found on. */
export interface ErasedRollupDay {
  tenantId: string;
  /** `YYYY-MM-DD`, the row's business day in UTC. */
  day: string;
}

export class GovernanceRollupErasureClickHouseRepository {
  constructor(
    private readonly resolveClient: (
      tenantId: string,
    ) => Promise<ClickHouseClient>,
  ) {}

  /**
   * Every `(tenant, day)` holding a rollup row under this exact actor id.
   *
   * Not dedup-safe, on purpose, and this is the one read in the governance tree
   * where that is correct. A dedup-safe read answers "what is the current
   * figure", which would hide a superseded row version that still carries the
   * erased identifier in the table. Erasure is about what is stored, not about
   * what the latest version says, so it looks at every version.
   *
   * Tenants are queried one at a time rather than through a single `IN` list
   * because the client resolver maps a tenant to its organization's ClickHouse
   * instance, and an organization on a dedicated instance would otherwise have
   * one query aimed at the wrong one. Per-tenant is the same predicate, issued
   * where it can be answered.
   */
  async findDaysCarryingActor({
    tenantIds,
    rawActorId,
  }: {
    tenantIds: string[];
    rawActorId: string;
  }): Promise<ErasedRollupDay[]> {
    const days: ErasedRollupDay[] = [];
    for (const tenantId of tenantIds) {
      const client = await this.resolveClient(tenantId);
      const result = await client.query({
        query: `
          SELECT DISTINCT toString(Day) AS Day
          FROM ${GOVERNANCE_COST_ROLLUP_TABLE}
          WHERE TenantId = {tenantId:String}
            AND RawActorId = {rawActorId:String}
          ORDER BY Day ASC
        `,
        query_params: { tenantId, rawActorId },
        format: "JSONEachRow",
      });
      const rows = (await result.json()) as Record<string, unknown>[];
      for (const row of rows) {
        days.push({ tenantId, day: String(row.Day ?? "") });
      }
    }
    return days;
  }

  /**
   * Removes every rollup row carrying this actor id, across the organization's
   * whole tenant history.
   *
   * Scoped by `TenantId`, never by `OrganizationId`, and the distinction is
   * load-bearing rather than stylistic. `OrganizationId` is a payload column
   * carrying `DEFAULT ''`, so a predicate on it silently misses every row
   * written before the column was populated and leaves the erased identifier
   * sitting in the table. `TenantId` leads the ORDER BY and is never empty.
   *
   * `mutations_sync: "1"` because the caller replays these days immediately
   * afterwards: an asynchronous mutation racing a replay could delete the rows
   * the replay had just rewritten.
   */
  async deleteRowsCarryingActor({
    tenantIds,
    rawActorId,
  }: {
    tenantIds: string[];
    rawActorId: string;
  }): Promise<void> {
    for (const tenantId of tenantIds) {
      const client = await this.resolveClient(tenantId);
      try {
        await client.exec({
          query: `
            ALTER TABLE ${GOVERNANCE_COST_ROLLUP_TABLE}
            DELETE WHERE TenantId = {tenantId:String}
              AND RawActorId = {rawActorId:String}
          `,
          query_params: { tenantId, rawActorId },
          clickhouse_settings: { mutations_sync: "1" },
        });
      } catch (error) {
        logger.error(
          { error, tenantId },
          "Failed to delete erased actor rows from governance_cost_rollup_1d — the erasure is incomplete for this tenant",
        );
        throw error;
      }
    }
  }
}
