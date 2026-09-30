// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The daily cost rollup fold, at the level where its rules are decidable
 * without a datastore: what the group key is made of, what a restatement does
 * to the day's figure, and why the fold refuses the out-of-order re-fold.
 *
 * The storage-shaped rules — one row per combination, survival of compaction,
 * a version-aware read — need real ClickHouse and live in
 * `governanceCostRollup.integration.test.ts`.
 *
 * Spec: specs/governance/governance-cost-rollup.feature
 * Decision: ADR-128.
 */
import { describe, expect, it } from "vitest";

import {
  GOVERNANCE_COST_CURRENCY_USD,
  GOVERNANCE_COST_SOURCE,
} from "../governanceCostRollup.constants";
import {
  GovernanceCostRollupFoldProjection,
  type GovernanceCostRollupState,
  governanceCostRollupKey,
  governanceCostRollupTotals,
} from "../governanceCostRollup.foldProjection";

const TENANT = "proj_governance_home";
const DAY_MS = Date.parse("2026-08-01T09:30:00.000Z");

function projection() {
  return new GovernanceCostRollupFoldProjection({
    store: {
      store: async () => undefined,
      get: async () => null,
    },
  });
}

/**
 * One pulled observation of one provider bucket.
 *
 * `costNanoMinor` is the money in the provider's own minor units and
 * `currencyCode` says which currency those are. Both are required here rather
 * than defaulted: the fold does not validate its events, so a helper that
 * omitted the money would hand the fold `undefined` and every amount assertion
 * downstream would compare against `NaN` while still appearing to pass.
 */
function observedEvent({
  costNanoMinor,
  currencyCode = GOVERNANCE_COST_CURRENCY_USD,
  costNanoUsd = null,
  restatementKey = "bucket-hash",
  observedAtMs,
  occurredAtMs = DAY_MS,
  costStatus = "estimate",
  id = `evt-pulled-${restatementKey}-${observedAtMs}`,
  tenantId = TENANT,
  rawActorId,
  agentId,
}: {
  costNanoMinor: number;
  currencyCode?: string;
  costNanoUsd?: number | null;
  restatementKey?: string;
  observedAtMs: number;
  occurredAtMs?: number;
  costStatus?: "exact" | "estimate";
  id?: string;
  tenantId?: string;
  /** Omitted by default: the legacy shape, from before spend named a spender. */
  rawActorId?: string;
  /** Omitted by default, same legacy contract as `rawActorId` (#7881). */
  agentId?: string;
}) {
  return {
    id,
    type: "lw.obs.pulled_usage.observed",
    tenantId,
    aggregateId: restatementKey,
    occurredAt: occurredAtMs,
    data: {
      itemKey: "usage_report:2026-08-01:1d",
      restatementKey,
      source: "anthropic_admin",
      ingestionSourceId: "src_1",
      organizationId: "org_acme",
      teamId: "team_platform",
      projectId: tenantId,
      model: "anthropic/claude-sonnet-5",
      tokensInput: 1_000,
      tokensOutput: 200,
      tokensCacheRead: 0,
      tokensCacheWrite: 0,
      costNanoMinor,
      currencyCode,
      costNanoUsd,
      rateVersion: "registry@2026-08-01",
      costBasis: "computed",
      costStatus,
      // Spread rather than always present, so an omitted value produces the
      // exact field-less shape every event before ADR-129 has on the log.
      ...(rawActorId === undefined ? {} : { rawActorId }),
      ...(agentId === undefined ? {} : { agentId }),
      occurredAtMs,
      observedAtMs,
    },
  } as never;
}

function fold(events: unknown[]): GovernanceCostRollupState {
  const p = projection();
  let state = p.init();
  for (const event of events) state = p.apply(state, event as never);
  return state;
}

describe("governanceCostRollupKey", () => {
  describe("given two pulled items that differ only by spender", () => {
    /** @scenario "Two spenders with identical numbers stay two rows after compaction" */
    it("puts each spender in its own group", () => {
      const ada = governanceCostRollupKey(
        observedEvent({
          costNanoMinor: 5_000,
          observedAtMs: DAY_MS,
          rawActorId: "user_ada",
        }),
      );
      const grace = governanceCostRollupKey(
        observedEvent({
          costNanoMinor: 5_000,
          observedAtMs: DAY_MS,
          rawActorId: "user_grace",
        }),
      );
      expect(ada).not.toBe(grace);
    });
  });

  describe("given two items on the same day and dimensions", () => {
    it("puts them in one group so the day is one row", () => {
      const morning = governanceCostRollupKey(
        observedEvent({
          costNanoMinor: 5_000,
          observedAtMs: DAY_MS,
          occurredAtMs: Date.parse("2026-08-01T01:00:00.000Z"),
          restatementKey: "bucket-a",
        }),
      );
      const evening = governanceCostRollupKey(
        observedEvent({
          costNanoMinor: 7_000,
          observedAtMs: DAY_MS,
          occurredAtMs: Date.parse("2026-08-01T23:59:59.000Z"),
          restatementKey: "bucket-b",
        }),
      );
      expect(morning).toBe(evening);
    });

    it("splits the group at the UTC day boundary", () => {
      const lastMoment = governanceCostRollupKey(
        observedEvent({
          costNanoMinor: 1,
          observedAtMs: DAY_MS,
          occurredAtMs: Date.parse("2026-08-01T23:59:59.999Z"),
        }),
      );
      const firstMoment = governanceCostRollupKey(
        observedEvent({
          costNanoMinor: 1,
          observedAtMs: DAY_MS,
          occurredAtMs: Date.parse("2026-08-02T00:00:00.000Z"),
        }),
      );
      expect(lastMoment).not.toBe(firstMoment);
    });
  });

  describe("given the same dimensions under two tenants", () => {
    it("never shares a group across tenants", () => {
      const mine = governanceCostRollupKey(
        observedEvent({ costNanoMinor: 1, observedAtMs: DAY_MS }),
      );
      const theirs = governanceCostRollupKey(
        observedEvent({
          costNanoMinor: 1,
          observedAtMs: DAY_MS,
          tenantId: "proj_someone_else",
        }),
      );
      expect(mine).not.toBe(theirs);
    });
  });

  describe("given a gateway spend event", () => {
    // The metered lane is read straight off its own per-request ledger; this
    // fold has no branch for it any more. Addressing one anyway would file
    // money under a cell the cost screen never reads, so the fold refuses
    // loudly rather than guessing a cell.
    it("refuses to address a cell for it", () => {
      expect(() =>
        governanceCostRollupKey({
          type: "lw.gateway.spend.confirmed",
          tenantId: TENANT,
          data: { occurred_at: DAY_MS, model: "openai/gpt-5-mini" },
        }),
      ).toThrow(/lw\.gateway\.spend\.confirmed/);
    });
  });

  describe("given pulled events and the spender they name (ADR-129)", () => {
    it("puts each named spender in its own group", () => {
      const ada = governanceCostRollupKey(
        observedEvent({
          costNanoMinor: 1,
          observedAtMs: DAY_MS,
          rawActorId: "user-ada",
        }),
      );
      const grace = governanceCostRollupKey(
        observedEvent({
          costNanoMinor: 1,
          observedAtMs: DAY_MS,
          rawActorId: "user-grace",
        }),
      );
      expect(ada).not.toBe(grace);
    });

    it("folds a legacy event into the same group as a blank-actor one", () => {
      // The whole no-migration promise of ADR-129: an event written before
      // the field existed and one that says "" mean the same thing and must
      // land on the same row — a rebuild over mixed history may never split
      // a day's money by schema vintage.
      const legacy = governanceCostRollupKey(
        observedEvent({ costNanoMinor: 1, observedAtMs: DAY_MS }),
      );
      const blank = governanceCostRollupKey(
        observedEvent({
          costNanoMinor: 1,
          observedAtMs: DAY_MS,
          rawActorId: "",
        }),
      );
      expect(legacy).toBe(blank);
    });

    it("puts each named agent in its own group, and legacy beside blank (#7881)", () => {
      const spaceOne = governanceCostRollupKey(
        observedEvent({
          costNanoMinor: 1,
          observedAtMs: DAY_MS,
          agentId: "space_1",
        }),
      );
      const spaceTwo = governanceCostRollupKey(
        observedEvent({
          costNanoMinor: 1,
          observedAtMs: DAY_MS,
          agentId: "space_2",
        }),
      );
      const legacy = governanceCostRollupKey(
        observedEvent({ costNanoMinor: 1, observedAtMs: DAY_MS }),
      );
      const blank = governanceCostRollupKey(
        observedEvent({ costNanoMinor: 1, observedAtMs: DAY_MS, agentId: "" }),
      );

      expect(spaceOne).not.toBe(spaceTwo);
      expect(spaceOne).not.toBe(blank);
      expect(legacy).toBe(blank);
    });

    it("keeps a named event out of the blank group", () => {
      const blank = governanceCostRollupKey(
        observedEvent({ costNanoMinor: 1, observedAtMs: DAY_MS }),
      );
      const named = governanceCostRollupKey(
        observedEvent({
          costNanoMinor: 1,
          observedAtMs: DAY_MS,
          rawActorId: "user-ada",
        }),
      );
      expect(named).not.toBe(blank);
    });
  });
});

describe("GovernanceCostRollupFoldProjection", () => {
  describe("given several pulled items on one day and dimension combination", () => {
    /** @scenario "A day's spend lands as one summary row per dimension combination" */
    it("holds the sum of those items as the day's amount", () => {
      const state = fold([
        observedEvent({
          costNanoMinor: 5_000_000_000,
          observedAtMs: DAY_MS,
          restatementKey: "bucket-a",
        }),
        observedEvent({
          costNanoMinor: 7_340_000_000,
          observedAtMs: DAY_MS,
          restatementKey: "bucket-b",
        }),
      ]);
      expect(governanceCostRollupTotals(state).amountNanoUsd).toBe(
        12_340_000_000,
      );
      expect(governanceCostRollupTotals(state).requestCount).toBe(2);
    });

    it("keeps the provider's business day, not the ingest day", () => {
      const state = fold([
        observedEvent({
          costNanoMinor: 1_000,
          observedAtMs: Date.parse("2026-08-03T04:00:00.000Z"),
        }),
      ]);
      expect(state.day).toBe("2026-08-01");
    });

    it("states the currency and the lane rather than leaving them implied", () => {
      const state = fold([
        observedEvent({ costNanoMinor: 1_000, observedAtMs: DAY_MS }),
      ]);
      expect(state.currencyCode).toBe(GOVERNANCE_COST_CURRENCY_USD);
      expect(state.costSource).toBe(GOVERNANCE_COST_SOURCE.PULLED);
    });
  });

  describe("given the events the fold subscribes to", () => {
    // The list stays EXACT rather than becoming a "does not include" check.
    // Exactness is what makes an accidental subscription fail here, and a
    // subscription is not a thing anyone adds by accident twice.
    //
    // The retraction belongs on it: it carries the retracted cell's own
    // resolved dimensions and states its amount as zero on purpose, so it
    // addresses one existing cell rather than filing a new amount-less one.
    // Leaving it off is what breaks the fold — the projection would never see
    // the event that withdraws a superseded charge.
    it("reacts to the two pulled events and nothing else", () => {
      expect(projection().eventTypes).toEqual([
        "lw.obs.pulled_usage.observed",
        "lw.obs.pulled_usage.retracted",
      ]);
    });

    // The metered lane once folded here too, writing gateway cells the cost
    // screen never read. It is served from its own per-request ledger now, so
    // a gateway subscription reappearing on this fold is the regression.
    it("subscribes to no gateway event", () => {
      const gatewayTypes = projection().eventTypes.filter((type) =>
        type.startsWith("lw.gateway."),
      );
      expect(gatewayTypes).toEqual([]);
    });
  });

  describe("given a cell nothing has contributed to", () => {
    // Zero is a real amount and charts as free usage. The absence of a figure
    // is a different fact and has to say so.
    it("reports no amount rather than an amount of zero", () => {
      expect(governanceCostRollupTotals(fold([])).amountNanoUsd).toBe(null);
      expect(governanceCostRollupTotals(fold([])).amountNanoMinor).toBe(0);
    });
  });

  describe("given a figure the provider stated in another currency", () => {
    it("reports no dollar amount rather than passing the foreign figure off as dollars", () => {
      const state = fold([
        observedEvent({
          costNanoMinor: 5_000,
          currencyCode: "EUR",
          observedAtMs: DAY_MS,
        }),
      ]);
      const totals = governanceCostRollupTotals(state);
      expect(totals.amountNanoUsd).toBe(null);
      expect(totals.amountNanoMinor).toBe(5_000);
    });
  });

  describe("given the provider restates a day it already reported", () => {
    /** @scenario "A restated day reads as the restated amount even before compaction" */
    it("replaces the figure instead of adding to it", () => {
      const state = fold([
        observedEvent({
          costNanoMinor: 12_340_000_000,
          observedAtMs: Date.parse("2026-08-02T04:00:00.000Z"),
          id: "first",
        }),
        observedEvent({
          costNanoMinor: 9_000_000_000,
          observedAtMs: Date.parse("2026-08-03T04:00:00.000Z"),
          costStatus: "exact",
          id: "restated",
        }),
      ]);
      const totals = governanceCostRollupTotals(state);
      expect(totals.amountNanoUsd).toBe(9_000_000_000);
      // The billed amount too, not only the dollar view of it. The dollar
      // figure can be produced from a per-item field, so asserting it alone
      // let a run where the billed amount was NaN report as passing.
      expect(totals.amountNanoMinor).toBe(9_000_000_000);
      expect(state.revisionCount).toBe(1);
      expect(state.previousAmountNanoUsd).toBe(12_340_000_000);
      expect(state.exactOrEstimate).toBe("exact");
    });

    it("keeps the newest observation when a stale one is redelivered", () => {
      const state = fold([
        observedEvent({
          costNanoMinor: 9_000_000_000,
          observedAtMs: Date.parse("2026-08-03T04:00:00.000Z"),
          id: "restated",
        }),
        observedEvent({
          costNanoMinor: 12_340_000_000,
          observedAtMs: Date.parse("2026-08-02T04:00:00.000Z"),
          id: "first",
        }),
      ]);
      expect(governanceCostRollupTotals(state).amountNanoUsd).toBe(
        9_000_000_000,
      );
    });

    it("adds two different provider items rather than restating one", () => {
      const state = fold([
        observedEvent({
          costNanoMinor: 1_000,
          restatementKey: "bucket-a",
          observedAtMs: DAY_MS,
          id: "a",
        }),
        observedEvent({
          costNanoMinor: 2_000,
          restatementKey: "bucket-b",
          observedAtMs: DAY_MS,
          id: "b",
        }),
      ]);
      expect(governanceCostRollupTotals(state).amountNanoUsd).toBe(3_000);
      expect(state.revisionCount).toBe(0);
    });
  });

  describe("given events arriving out of business-time order", () => {
    // The executor's re-fold loads history by `context.aggregateId`
    // (foldProjectionExecutor.ts) — the EVENT's aggregate, which for this fold
    // is one pulled item, never the day-wide group the key names. A re-fold
    // would therefore rebuild the day out of one item's events and throw the
    // rest of the day away. The fold's accumulators commute and its
    // restatement rule keys on data the event carries (`observedAtMs`), so
    // there is nothing a replay could derive.
    it("declines the out-of-order re-fold that would load the wrong population", () => {
      expect(projection().options.refoldOnOutOfOrder).toBe(false);
    });

    it("reaches the same total whichever order the items arrive in", () => {
      const first = observedEvent({
        costNanoMinor: 300,
        restatementKey: "bucket-a",
        observedAtMs: Date.parse("2026-08-02T01:00:00.000Z"),
        id: "a",
      });
      const second = observedEvent({
        costNanoMinor: 700,
        restatementKey: "bucket-b",
        observedAtMs: Date.parse("2026-08-02T02:00:00.000Z"),
        id: "b",
      });
      const forwards = fold([first, second]);
      const backwards = fold([second, first]);
      // The value first, then the equality. `toBe` is Object.is, so NaN
      // equals NaN — an assertion of equality alone passes for a fold that
      // read the money field under a name the events do not carry, which is
      // exactly how this test came to assert nothing once already.
      expect(governanceCostRollupTotals(forwards).amountNanoUsd).toBe(1_000);
      expect(governanceCostRollupTotals(backwards).amountNanoUsd).toBe(
        governanceCostRollupTotals(forwards).amountNanoUsd,
      );
    });
  });
});
