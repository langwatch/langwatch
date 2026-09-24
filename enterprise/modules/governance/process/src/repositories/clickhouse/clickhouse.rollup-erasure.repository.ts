// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { createLogger } from "@langwatch/observability";

import { type ErasedRollupDay, RollupErasureRepository } from "../rollup-erasure.repository.ts";

const logger = createLogger("langwatch:governance:rollup-erasure");

const GOVERNANCE_COST_ROLLUP_TABLE = "governance_cost_rollup_1d";
const GOVERNANCE_COST_ROLLUP_RESTATEMENT_INDEX_TABLE = "governance_cost_rollup_restatement_index";

/** `mutations_sync` so the erasure does not return while the rows still exist. */
export class ClickHouseRollupErasureRepository extends RollupErasureRepository {
  private constructor(
    private readonly clickhouse: Pick<ClickHouseQueryClient, "query" | "command">,
  ) {
    super();
  }

  static create(
    clickhouse: Pick<ClickHouseQueryClient, "query" | "command">,
  ): ClickHouseRollupErasureRepository {
    return new ClickHouseRollupErasureRepository(clickhouse);
  }

  async findDaysCarryingActor({
    tenantIds,
    rawActorId,
  }: {
    tenantIds: string[];
    rawActorId: string;
  }): Promise<ErasedRollupDay[]> {
    const days: ErasedRollupDay[] = [];
    for (const tenantId of tenantIds) {
      const result = await this.clickhouse.query<{ Day: string }>({
        tenantId,
        sql: `
          SELECT DISTINCT toString(Day) AS Day
          FROM ${GOVERNANCE_COST_ROLLUP_TABLE}
          WHERE TenantId = {tenantId:String}
            AND RawActorId = {rawActorId:String}
          ORDER BY Day ASC
        `,
        params: { tenantId, rawActorId },
      });
      for (const row of result.rows) days.push({ tenantId, day: row.Day });
    }
    return days;
  }

  async deleteRowsCarryingActor({
    tenantIds,
    rawActorId,
  }: {
    tenantIds: string[];
    rawActorId: string;
  }): Promise<void> {
    for (const tenantId of tenantIds) {
      try {
        await this.clickhouse.command({
          tenantId,
          sql: `
            ALTER TABLE ${GOVERNANCE_COST_ROLLUP_TABLE}
            DELETE WHERE TenantId = {tenantId:String}
              AND RawActorId = {rawActorId:String}
          `,
          params: { tenantId, rawActorId },
          settings: { mutations_sync: "1" },
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

  async renameActorInRestatementIndex({
    tenantIds,
    rawActorId,
    pseudonymousActorId,
  }: {
    tenantIds: string[];
    rawActorId: string;
    pseudonymousActorId: string;
  }): Promise<void> {
    for (const tenantId of tenantIds) {
      try {
        await this.clickhouse.command({
          tenantId,
          sql: `
            ALTER TABLE ${GOVERNANCE_COST_ROLLUP_RESTATEMENT_INDEX_TABLE}
            UPDATE RawActorId = {pseudonymousActorId:String}
            WHERE TenantId = {tenantId:String}
              AND RawActorId = {rawActorId:String}
          `,
          params: { tenantId, rawActorId, pseudonymousActorId },
          settings: { mutations_sync: "1" },
        });
      } catch (error) {
        logger.error(
          { error, tenantId },
          "Failed to overwrite the erased actor id in governance_cost_rollup_restatement_index — the erasure is incomplete for this tenant",
        );
        throw error;
      }
    }
  }
}
