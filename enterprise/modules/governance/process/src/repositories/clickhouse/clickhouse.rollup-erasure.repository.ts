// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { clickhouseRead, fn, tenantScope } from "@langwatch/clickhouse-client/builder";
import { createLogger } from "@langwatch/observability";

import { GOVERNANCE_COST_CHARGE_TABLE } from "../governance-cost-charge.repository.ts";
import { type ErasedRollupDay, RollupErasureRepository } from "../rollup-erasure.repository.ts";
import { governanceCostRollup1d as rollup } from "./clickhouse.governance-cost-rollup-1d.table.ts";

const logger = createLogger("langwatch:governance:rollup-erasure");

const GOVERNANCE_COST_ROLLUP_TABLE = rollup.$table.name;
const GOVERNANCE_COST_ROLLUP_RESTATEMENT_INDEX_TABLE = "governance_cost_rollup_restatement_index";

/** `mutations_sync` so the erasure does not return while the rows still exist. */
export class ClickHouseRollupErasureRepository extends RollupErasureRepository {
  private constructor(
    private readonly clickhouse: Pick<ClickHouseQueryClient, "read" | "command">,
  ) {
    super();
  }

  static create(
    clickhouse: Pick<ClickHouseQueryClient, "read" | "command">,
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
      const statement = clickhouseRead({ scope: tenantScope.single({ tenantId }) })
        .from(rollup)
        .distinct()
        .select({ DayText: fn.toString(rollup.Day) })
        .where(({ eq }) => eq(rollup.RawActorId, rawActorId))
        .orderBy("DayText")
        .build();
      const result = await this.clickhouse.read({ statement });
      for (const row of result.rows) days.push({ tenantId, day: row.DayText });
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

  async renameActorInCharges({
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
            ALTER TABLE ${GOVERNANCE_COST_CHARGE_TABLE}
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
          `Failed to overwrite the erased actor id in ${GOVERNANCE_COST_CHARGE_TABLE}; the erasure is incomplete for this tenant`,
        );
        throw error;
      }
    }
  }
}
