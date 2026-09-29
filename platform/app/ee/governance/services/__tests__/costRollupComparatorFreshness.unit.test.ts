// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * What a comparison can and cannot see about a summary that is merely behind,
 * rather than wrong.
 *
 * The rollup fold and the check that reads it run on independent queues, so a
 * charge landing shortly before the check can be re-derived here while its own
 * projection job is still waiting to run. Both sides carry the newest charge
 * moment they have folded, and where those two differ the comparison can say
 * outright that the summary has not caught up.
 *
 * Where they AGREE it can say nothing, and the last case here is the proof: a
 * maximum cannot count, so a charge sharing its moment with one already folded
 * leaves the two watermarks level while the money differs. That is why nothing
 * in this file decides anything — the deciding is the retry ladder's, over in
 * `costRollupWatch.settling.unit.test.ts`.
 *
 * Spec: specs/governance/cost-rollup-watch.feature
 * Decision: ADR-128.
 */
import { describe, expect, it } from "vitest";

import { GOVERNANCE_COST_SOURCE } from "../../projections/governanceCostRollup.constants";
import { CostRollupComparatorService } from "../costRollupComparator.service";
import type {
  GovernanceCostRollupClickHouseRepository,
  GovernanceCostRollupRow,
} from "../governanceCostRollup.clickhouse.repository";

const TENANT = "proj_governance_home";
const DAY = "2026-08-23";
/** The charge the summary has folded, and the one that landed after it. */
const FOLDED_AT = Date.parse(`${DAY}T09:30:00.000Z`);
const LATE_AT = Date.parse(`${DAY}T23:50:00.000Z`);

/**
 * One pulled observation as the comparator reads it back off the log.
 *
 * `occurredAt` on the envelope is what the fold's watermark is made of;
 * `occurredAtMs` inside the payload is what the cell's day is made of. They
 * are the same moment in production and are varied separately here, because
 * the whole question is which of the two each side is measured by.
 *
 * `occurredAt` carries no default deliberately — a default would swallow the
 * `undefined` that one scenario exists to pass, and that scenario would then
 * quietly assert nothing.
 */
function loggedEvent({
  costNanoMinor,
  occurredAt,
  dayAtMs = FOLDED_AT,
}: {
  costNanoMinor: number;
  occurredAt: number | undefined;
  dayAtMs?: number;
}) {
  return {
    type: "lw.obs.pulled_usage.observed",
    tenantId: TENANT,
    occurredAt,
    data: {
      itemKey: `azure_cost:${DAY}:Azure Databricks`,
      restatementKey: `bucket-${costNanoMinor}`,
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
      currencyCode: "USD",
      costNanoUsd: costNanoMinor,
      rateVersion: null,
      costBasis: "provider_reported",
      costStatus: "exact",
      occurredAtMs: dayAtMs,
      observedAtMs: dayAtMs,
    },
  };
}

/** The stored summary row those events should have produced. */
function summaryRow({
  amountNanoMinor,
  lastEventOccurredAtMs,
}: {
  amountNanoMinor: number;
  lastEventOccurredAtMs: number;
}): GovernanceCostRollupRow {
  return {
    TenantId: TENANT,
    Day: DAY,
    CostSource: GOVERNANCE_COST_SOURCE.PULLED,
    IngestionSourceId: "src_1",
    Provider: "copilot_studio_dataverse",
    Model: "Azure Databricks",
    AgentId: "",
    CurrencyCode: "USD",
    RawActorId: "",
    OrganizationId: "org_acme",
    ExactOrEstimate: "exact",
    AmountNanoUsd: amountNanoMinor,
    AmountNanoMinor: amountNanoMinor,
    TokensInput: 0,
    TokensOutput: 0,
    TokensCacheRead: 0,
    TokensCacheWrite: 0,
    RequestCount: 1,
    RevisionCount: 0,
    PreviousAmountNanoUsd: null,
    RevisedAt: null,
    LastObservedAt: Math.floor(lastEventOccurredAtMs / 1000),
    PulledItemsJson: "{}",
    Version: "v1",
    AppliedEventIds: [],
    CreatedAt: lastEventOccurredAtMs,
    LastEventOccurredAt: lastEventOccurredAtMs,
    EventTimestamp: lastEventOccurredAtMs,
  } as GovernanceCostRollupRow;
}

function compare({
  events,
  rows,
}: {
  events: ReturnType<typeof loggedEvent>[];
  rows: GovernanceCostRollupRow[];
}) {
  const repo = {
    findCostEventsForDay: async () => events,
    findCellsForDay: async () => rows,
    findLatestEventOccurredAt: async () => LATE_AT,
    findLatestSummarizedOccurredAt: async () =>
      rows[0]?.LastEventOccurredAt ?? null,
  } as unknown as GovernanceCostRollupClickHouseRepository;
  return new CostRollupComparatorService(repo).compareDay({
    tenantId: TENANT,
    day: DAY,
    costSource: GOVERNANCE_COST_SOURCE.PULLED,
  });
}

describe("what a comparison sees of a summary that is still catching up", () => {
  describe("when a charge landed after the newest one the summary has folded", () => {
    /** @scenario A charge the summary has not folded yet is named as still folding */
    it("names the cell as behind alongside the difference in the money", async () => {
      const comparison = await compare({
        events: [
          loggedEvent({ costNanoMinor: 1_000_000_000, occurredAt: FOLDED_AT }),
          loggedEvent({ costNanoMinor: 2_000_000_000, occurredAt: LATE_AT }),
        ],
        // Exactly what the fold would hold having applied only the first.
        rows: [
          summaryRow({
            amountNanoMinor: 1_000_000_000,
            lastEventOccurredAtMs: FOLDED_AT,
          }),
        ],
      });

      expect(comparison.behind).toHaveLength(1);
      expect(comparison.behind[0]).toMatchObject({
        derivedLastEventOccurredAtMs: LATE_AT,
        summarizedLastEventOccurredAtMs: FOLDED_AT,
      });
      expect(comparison.mismatches).toHaveLength(1);
    });
  });

  describe("when the summary has folded every charge the day holds", () => {
    /** @scenario A summary that covers every charge of the day is named as behind by nothing */
    it("names nothing as behind and states the difference in the money", async () => {
      const comparison = await compare({
        events: [
          loggedEvent({ costNanoMinor: 1_000_000_000, occurredAt: FOLDED_AT }),
          loggedEvent({ costNanoMinor: 2_000_000_000, occurredAt: LATE_AT }),
        ],
        rows: [
          summaryRow({
            amountNanoMinor: 999,
            lastEventOccurredAtMs: LATE_AT,
          }),
        ],
      });

      expect(comparison.behind).toEqual([]);
      expect(comparison.mismatches).toHaveLength(1);
      expect(comparison.mismatches[0]?.summarizedNanoMinor).toBe(999);
      expect(comparison.mismatches[0]?.derivedNanoMinor).toBe(3_000_000_000);
    });
  });

  describe("when the summary holds no row for the charge's cell at all", () => {
    /** @scenario A cell the summary holds nothing for is named as still folding */
    it("names the missing cell as behind, with nothing folded into it", async () => {
      const comparison = await compare({
        events: [
          loggedEvent({ costNanoMinor: 1_000_000_000, occurredAt: FOLDED_AT }),
        ],
        rows: [],
      });

      expect(comparison.behind).toHaveLength(1);
      expect(comparison.behind[0]?.summarizedLastEventOccurredAtMs).toBeNull();
    });
  });

  describe("when the charge carries no moment the summary can be measured against", () => {
    /** @scenario A charge carrying no usable moment is never named as still folding */
    it("names nothing as behind, so a garbage moment cannot park the day forever", async () => {
      const comparison = await compare({
        events: [
          loggedEvent({ costNanoMinor: 1_000_000_000, occurredAt: undefined }),
        ],
        rows: [],
      });

      expect(comparison.behind).toEqual([]);
      expect(comparison.mismatches).toHaveLength(1);
      expect(comparison.mismatches[0]?.summarizedNanoMinor).toBeNull();
    });
  });

  describe("when an unfolded charge shares its moment with one already folded", () => {
    // The blind spot this signal has by construction, pinned so nobody builds
    // on it again: two charges on one cell stamped with the same moment — an
    // hourly export bucket, say — leave the maximum where it was, so the side
    // that folded one and the side that folded both read as level.
    /** @scenario A charge sharing its moment with a folded one leaves the watermarks level */
    it("names nothing as behind even though the money plainly differs", async () => {
      const comparison = await compare({
        events: [
          loggedEvent({ costNanoMinor: 1_000_000_000, occurredAt: FOLDED_AT }),
          loggedEvent({ costNanoMinor: 2_000_000_000, occurredAt: FOLDED_AT }),
        ],
        rows: [
          summaryRow({
            amountNanoMinor: 1_000_000_000,
            lastEventOccurredAtMs: FOLDED_AT,
          }),
        ],
      });

      expect(comparison.behind).toEqual([]);
      expect(comparison.mismatches).toHaveLength(1);
      expect(comparison.mismatches[0]?.derivedNanoMinor).toBe(3_000_000_000);
    });
  });
});
