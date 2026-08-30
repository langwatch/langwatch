// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The watchdog on a row that is not in dollars.
 *
 * Comparing the dollar column makes it blind exactly where that column is
 * empty by design: on a non-dollar row both sides read as absent, agree with
 * each other, and the real amounts can be anything at all. The comparison has
 * to be on the amount in the currency it was billed in, which every row has.
 *
 * Spec: specs/governance/governance-cost-rollup.feature
 * Decision: ADR-128 §3.
 */
import { describe, expect, it } from "vitest";

import { GOVERNANCE_COST_SOURCE } from "../../projections/governanceCostRollup.constants";
import type {
  GovernanceCostRollupClickHouseRepository,
  GovernanceCostRollupRow,
} from "../governanceCostRollup.clickhouse.repository";
import { CostRollupComparatorService } from "../costRollupComparator.service";

const TENANT = "proj_governance_home";
const DAY = "2026-08-23";
const OCCURRED_AT = Date.parse(`${DAY}T09:30:00.000Z`);

/** One pulled observation as the comparator reads it back off the log. */
function loggedEvent({
  costNanoMinor,
  currencyCode,
  costNanoUsd = null,
}: {
  costNanoMinor: number;
  currencyCode: string;
  costNanoUsd?: number | null;
}) {
  return {
    type: "lw.obs.pulled_usage.observed",
    tenantId: TENANT,
    occurredAt: OCCURRED_AT,
    data: {
      itemKey: "azure_cost:2026-08-23:Azure Databricks",
      restatementKey: "bucket-hash",
      source: "copilot_studio_dataverse",
      ingestionSourceId: "src_1",
      organizationId: "org_acme",
      teamId: null,
      projectId: TENANT,
      model: "Azure Databricks",
      tokensInput: 0,
      tokensOutput: 0,
      tokensCacheRead: 0,
      tokensCacheWrite: 0,
      costNanoMinor,
      currencyCode,
      costNanoUsd,
      rateVersion: null,
      costBasis: "provider_reported",
      costStatus: "exact",
      occurredAtMs: OCCURRED_AT,
      observedAtMs: Date.parse("2026-08-30T09:00:00.000Z"),
    },
  };
}

/** The stored summary row those events should have produced. */
function summaryRow({
  currencyCode,
  amountNanoMinor,
  amountNanoUsd = null,
}: {
  currencyCode: string;
  amountNanoMinor: number;
  amountNanoUsd?: number | null;
}): GovernanceCostRollupRow {
  return {
    TenantId: TENANT,
    Day: DAY,
    CostSource: GOVERNANCE_COST_SOURCE.PULLED,
    IngestionSourceId: "src_1",
    Provider: "copilot_studio_dataverse",
    Model: "Azure Databricks",
    AgentId: "",
    CurrencyCode: currencyCode,
    RawActorId: "",
    OrganizationId: "org_acme",
    ExactOrEstimate: "exact",
    AmountNanoUsd: amountNanoUsd,
    AmountNanoMinor: amountNanoMinor,
    TokensInput: 0,
    TokensOutput: 0,
    TokensCacheRead: 0,
    TokensCacheWrite: 0,
    RequestCount: 1,
    RevisionCount: 0,
    PreviousAmountNanoUsd: null,
    PulledItemsJson: "{}",
    Version: "v1",
    AppliedEventIds: [],
    CreatedAt: OCCURRED_AT,
    LastEventOccurredAt: OCCURRED_AT,
    EventTimestamp: OCCURRED_AT,
  } as GovernanceCostRollupRow;
}

function comparatorOver({
  events,
  rows,
}: {
  events: ReturnType<typeof loggedEvent>[];
  rows: GovernanceCostRollupRow[];
}) {
  const repo = {
    findCostEventsForDay: async () => events,
    findCellsForDay: async () => rows,
    findLatestEventOccurredAt: async () => OCCURRED_AT,
    findLatestSummarizedOccurredAt: async () => OCCURRED_AT,
  } as unknown as GovernanceCostRollupClickHouseRepository;
  return new CostRollupComparatorService(repo);
}

describe("the cost rollup watchdog on a non-dollar row", () => {
  describe("when the stored amount disagrees with the events", () => {
    /** @scenario "The watchdog compares the amount in the currency it was billed in" */
    it("counts the drift even though neither side states a dollar figure", async () => {
      const comparison = await comparatorOver({
        events: [loggedEvent({ costNanoMinor: 1_533_525_880, currencyCode: "EUR" })],
        rows: [summaryRow({ currencyCode: "EUR", amountNanoMinor: 999 })],
      }).compareDay({
        tenantId: TENANT,
        day: DAY,
        costSource: GOVERNANCE_COST_SOURCE.PULLED,
      });

      expect(comparison.mismatches).toHaveLength(1);
      expect(comparison.mismatches[0]?.cell.currencyCode).toBe("EUR");
    });
  });

  describe("when the stored amount matches the events", () => {
    /** @scenario "The watchdog compares the amount in the currency it was billed in" */
    it("reports no drift", async () => {
      const comparison = await comparatorOver({
        events: [loggedEvent({ costNanoMinor: 1_533_525_880, currencyCode: "EUR" })],
        rows: [
          summaryRow({ currencyCode: "EUR", amountNanoMinor: 1_533_525_880 }),
        ],
      }).compareDay({
        tenantId: TENANT,
        day: DAY,
        costSource: GOVERNANCE_COST_SOURCE.PULLED,
      });

      // The guard on the guard: without this the test above passes for a
      // comparator that simply reports everything as drifted.
      expect(comparison.mismatches).toEqual([]);
    });
  });

  describe("when a dollar row disagrees with its events", () => {
    /** @scenario "The comparator counts a summary that drifted from its events" */
    it("still counts the drift", async () => {
      const comparison = await comparatorOver({
        events: [
          loggedEvent({ costNanoMinor: 2_500_000_000, currencyCode: "USD" }),
        ],
        rows: [
          summaryRow({
            currencyCode: "USD",
            amountNanoMinor: 1,
            amountNanoUsd: 1,
          }),
        ],
      }).compareDay({
        tenantId: TENANT,
        day: DAY,
        costSource: GOVERNANCE_COST_SOURCE.PULLED,
      });

      expect(comparison.mismatches).toHaveLength(1);
    });
  });
});
