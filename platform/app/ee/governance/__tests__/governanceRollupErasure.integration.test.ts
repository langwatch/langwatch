// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * Erasure against the ClickHouse version we deploy, not a mock.
 *
 * Two of these assert facts about the ENGINE rather than about our code: that a
 * mutation on the sorting key is refused, and that a delete plus a rewrite under
 * the stand-in leaves the total intact. Both are load-bearing — the first is
 * the reason erasure removes and rebuilds instead of editing, and if a future
 * ClickHouse ever allowed the update, somebody would reach for it.
 *
 * Spec: specs/governance/governance-identity-and-erasure.feature
 * Decision: ADR-128 §9 step 4
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getTestClickHouseClient } from "~/server/event-sourcing/__tests__/integration/testContainers";
import { GOVERNANCE_COST_ROLLUP_TABLE } from "../projections/governanceCostRollup.constants";
import { GovernanceRollupErasureClickHouseRepository } from "../services/governanceRollupErasure.clickhouse.repository";

const ns = nanoid(8);
const CURRENT_TENANT = `project_gov_new_${ns}`;
const RETIRED_TENANT = `project_gov_old_${ns}`;
const ERASED = `leaver-${ns}@acme.test`;
const ACTIVE = `stays-${ns}@acme.test`;
const PSEUDONYM = "f".repeat(64);

/**
 * One rollup row. Only the columns this file reasons about are stated; the rest
 * take the table's own defaults, which is what a partial fold write does too.
 */
const row = (overrides: {
  tenantId: string;
  day: string;
  rawActorId: string;
  amountNanoUsd: number;
  eventTimestamp: number;
}) => ({
  TenantId: overrides.tenantId,
  Day: overrides.day,
  CostSource: "gateway",
  IngestionSourceId: "",
  Provider: "openai",
  Model: "gpt-5-mini",
  AgentId: "",
  CurrencyCode: "USD",
  RawActorId: overrides.rawActorId,
  OrganizationId: "",
  ExactOrEstimate: "exact",
  AmountNanoUsd: overrides.amountNanoUsd,
  AmountNanoMinor: overrides.amountNanoUsd,
  EventTimestamp: overrides.eventTimestamp,
});

describe("Feature: erasing an actor from the daily totals", () => {
  let client: ClickHouseClient;
  let repository: GovernanceRollupErasureClickHouseRepository;

  const insert = async (values: ReturnType<typeof row>[]) => {
    await client.insert({
      table: GOVERNANCE_COST_ROLLUP_TABLE,
      values,
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });
  };

  const actorTotals = async (tenantId: string) => {
    const result = await client.query({
      query: `
        SELECT RawActorId, sum(Amount) AS Total FROM (
          SELECT
            RawActorId,
            argMax(AmountNanoUsd, EventTimestamp) AS Amount
          FROM ${GOVERNANCE_COST_ROLLUP_TABLE}
          WHERE TenantId = {tenantId:String}
          GROUP BY TenantId, Day, CostSource, IngestionSourceId,
                   Provider, Model, AgentId, CurrencyCode, RawActorId
        )
        GROUP BY RawActorId
        ORDER BY RawActorId
      `,
      query_params: { tenantId },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Record<string, unknown>[];
    return new Map(
      rows.map((entry) => [String(entry.RawActorId), Number(entry.Total)]),
    );
  };

  beforeAll(async () => {
    const testClient = getTestClickHouseClient();
    if (!testClient) {
      throw new Error(
        "No test ClickHouse client — this suite asserts engine behaviour and proves nothing without one",
      );
    }
    client = testClient;
    repository = new GovernanceRollupErasureClickHouseRepository(
      async () => client,
    );

    await insert([
      row({
        tenantId: CURRENT_TENANT,
        day: "2026-08-20",
        rawActorId: ERASED,
        amountNanoUsd: 4_000_000_000,
        eventTimestamp: 1,
      }),
      row({
        tenantId: CURRENT_TENANT,
        day: "2026-08-21",
        rawActorId: ERASED,
        amountNanoUsd: 2_000_000_000,
        eventTimestamp: 1,
      }),
      row({
        tenantId: CURRENT_TENANT,
        day: "2026-08-20",
        rawActorId: ACTIVE,
        amountNanoUsd: 1_000_000_000,
        eventTimestamp: 1,
      }),
      // Spend in an area the organization has since retired.
      row({
        tenantId: RETIRED_TENANT,
        day: "2026-02-10",
        rawActorId: ERASED,
        amountNanoUsd: 500_000_000,
        eventTimestamp: 1,
      }),
    ]);
  });

  afterAll(async () => {
    await client.exec({
      query: `
        ALTER TABLE ${GOVERNANCE_COST_ROLLUP_TABLE}
        DELETE WHERE TenantId IN ({tenantIds:Array(String)})
      `,
      query_params: { tenantIds: [CURRENT_TENANT, RETIRED_TENANT] },
      clickhouse_settings: { mutations_sync: "1" },
    });
  });

  describe("given daily totals holding an erased person's identifier", () => {
    describe("when an edit is attempted on the identifier itself", () => {
      /** @scenario "The daily totals cannot be edited to remove a name" */
      it("is refused by the storage, which is why erasure removes and rebuilds", async () => {
        let caught: unknown;
        try {
          await client.exec({
            query: `
              ALTER TABLE ${GOVERNANCE_COST_ROLLUP_TABLE}
              UPDATE RawActorId = {pseudonym:String}
              WHERE TenantId = {tenantId:String} AND RawActorId = {rawActorId:String}
            `,
            query_params: {
              pseudonym: PSEUDONYM,
              tenantId: CURRENT_TENANT,
              rawActorId: ERASED,
            },
            clickhouse_settings: { mutations_sync: "1" },
          });
        } catch (error) {
          caught = error;
        }

        expect(caught).toBeDefined();
        expect(String(caught)).toMatch(
          /CANNOT_UPDATE_COLUMN|Cannot UPDATE key column/,
        );
      });
    });
  });

  describe("given an organization whose spend spans a current and a retired area", () => {
    /** @scenario "Erasure reaches areas the organization no longer uses" */
    it("finds the days in both areas, not only the current one", async () => {
      const days = await repository.findDaysCarryingActor({
        tenantIds: [CURRENT_TENANT, RETIRED_TENANT],
        rawActorId: ERASED,
      });

      expect(days).toEqual([
        { tenantId: CURRENT_TENANT, day: "2026-08-20" },
        { tenantId: CURRENT_TENANT, day: "2026-08-21" },
        { tenantId: RETIRED_TENANT, day: "2026-02-10" },
      ]);
    });

    describe("when the person is erased and the affected days are rebuilt", () => {
      /** @scenario "An erased person's spend comes back under the stand-in, with the same total" */
      it("leaves no row under the original identifier, and the stand-in holds the same total", async () => {
        const before = await actorTotals(CURRENT_TENANT);
        expect(before.get(ERASED)).toBe(6_000_000_000);

        await repository.deleteRowsCarryingActor({
          tenantIds: [CURRENT_TENANT, RETIRED_TENANT],
          rawActorId: ERASED,
        });

        // What the replay does: the same events, folded again, with the fold
        // substituting the stand-in on its way past (`actorIdForRollupWrite`).
        await insert([
          row({
            tenantId: CURRENT_TENANT,
            day: "2026-08-20",
            rawActorId: PSEUDONYM,
            amountNanoUsd: 4_000_000_000,
            eventTimestamp: 2,
          }),
          row({
            tenantId: CURRENT_TENANT,
            day: "2026-08-21",
            rawActorId: PSEUDONYM,
            amountNanoUsd: 2_000_000_000,
            eventTimestamp: 2,
          }),
        ]);

        const after = await actorTotals(CURRENT_TENANT);
        expect(after.has(ERASED)).toBe(false);
        expect(after.get(PSEUDONYM)).toBe(6_000_000_000);
        // Everybody else's money is untouched.
        expect(after.get(ACTIVE)).toBe(1_000_000_000);
      });

      it("removes the retired area's rows too", async () => {
        const remaining = await repository.findDaysCarryingActor({
          tenantIds: [RETIRED_TENANT],
          rawActorId: ERASED,
        });

        expect(remaining).toEqual([]);
      });
    });
  });
});
