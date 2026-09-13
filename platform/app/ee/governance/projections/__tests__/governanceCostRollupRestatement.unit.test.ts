// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The two markers a cost day carries about itself (ADR-128 §15): whether a
 * provider has already restated it, and when a pull last touched it.
 *
 * Both are decidable without a datastore, because both are properties of the
 * FOLD — what it does to state given events — and the point of every test here
 * is that neither ever reads a clock. A wall-clock read would pass every
 * assertion about a fresh fold and fail silently on the only run that matters,
 * a replay.
 *
 * Spec: specs/governance/governance-cost-restatement-markers.feature
 * Decision: ADR-128 §15.
 */
import { describe, expect, it } from "vitest";

import {
  GOVERNANCE_COST_CURRENCY_USD,
  GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST,
} from "../governanceCostRollup.constants";
import {
  GovernanceCostRollupFoldProjection,
  type GovernanceCostRollupState,
  governanceCostRollupKey,
  governanceCostRollupTotals,
} from "../governanceCostRollup.foldProjection";
import {
  governanceCostRollupStateFromRow,
  projectGovernanceCostRollupStateToRow,
} from "../governanceCostRollup.store";

const TENANT = "proj_governance_home";
const DAY_MS = Date.parse("2026-08-01T09:30:00.000Z");
const FIRST_PULL = Date.parse("2026-08-02T04:00:00.000Z");
const SECOND_PULL = Date.parse("2026-08-05T04:00:00.000Z");

function projection() {
  return new GovernanceCostRollupFoldProjection({
    store: { store: async () => undefined, get: async () => null },
  });
}

/** One pulled observation of one provider bucket. */
function observedEvent({
  costNanoMinor,
  observedAtMs,
  restatementKey = "bucket-hash",
  currencyCode = GOVERNANCE_COST_CURRENCY_USD,
  costNanoUsd = null,
  occurredAtMs = DAY_MS,
  rawActorId = "",
  id = `evt-pulled-${observedAtMs}-${restatementKey}`,
}: {
  costNanoMinor: number;
  observedAtMs: number;
  restatementKey?: string;
  currencyCode?: string;
  costNanoUsd?: number | null;
  occurredAtMs?: number;
  rawActorId?: string;
  id?: string;
}) {
  return {
    id,
    type: "lw.obs.pulled_usage.observed",
    tenantId: TENANT,
    aggregateId: restatementKey,
    occurredAt: occurredAtMs,
    data: {
      itemKey: "usage_report:2026-08-01:1d",
      restatementKey,
      source: "anthropic_admin",
      ingestionSourceId: "src_1",
      organizationId: "org_acme",
      teamId: "team_platform",
      projectId: TENANT,
      model: "anthropic/claude-sonnet-5",
      tokensInput: 1_000,
      tokensOutput: 200,
      tokensCacheRead: 0,
      tokensCacheWrite: 0,
      costNanoMinor,
      currencyCode,
      costNanoUsd,
      rawActorId,
      rateVersion: "registry@2026-08-01",
      costBasis: "computed",
      costStatus: "estimate",
      occurredAtMs,
      observedAtMs,
    },
  } as never;
}

/**
 * The event that withdraws what one restatement key holds in the cell it is
 * currently filed under.
 *
 * `lw.obs.pulled_usage.retracted` (settlement 9), whose shape is
 * `PulledUsageRetractedEventSchema`. Nothing emits one in production yet: the
 * detector that would compare an incoming key against the restatement index
 * is the piece still to be written.
 *
 * Built inline as a plain envelope, the same way the observed fixture above
 * is. The fold reads `type`, `tenantId` and `data` and nothing else, so
 * satisfying the full event envelope would mean carrying three fields it
 * never looks at and would say the fold depends on them.
 *
 * `costNanoMinor` is spelled out even though a retraction carries no money:
 * the cell a rollup event addresses is derived through `readPulledUsageMoney`,
 * which falls back to dollars for an event with no `costNanoMinor` at all - so
 * a retraction that omitted it would address the DOLLAR cell and leave the
 * euro one holding its money.
 */
function retractionEvent({
  observedAtMs,
  restatementKey = "bucket-hash",
  currencyCode = GOVERNANCE_COST_CURRENCY_USD,
  rawActorId = "",
  occurredAtMs = DAY_MS,
  id = `evt-retracted-${observedAtMs}-${restatementKey}`,
}: {
  observedAtMs: number;
  restatementKey?: string;
  currencyCode?: string;
  rawActorId?: string;
  occurredAtMs?: number;
  id?: string;
}) {
  return {
    id,
    type: "lw.obs.pulled_usage.retracted",
    tenantId: TENANT,
    aggregateId: restatementKey,
    occurredAt: occurredAtMs,
    data: {
      restatementKey,
      source: "anthropic_admin",
      ingestionSourceId: "src_1",
      organizationId: "org_acme",
      model: "anthropic/claude-sonnet-5",
      costNanoMinor: 0,
      currencyCode,
      costNanoUsd: null,
      rawActorId,
      // The day the retraction CORRECTS, not the day the correction arrived.
      // The comparator re-derives a day from the events falling inside it, so
      // a retraction dated to its own arrival is never read by it.
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

describe("the restatement marker", () => {
  describe("when one pull revises two items in the same cell", () => {
    /** @scenario "One pull revising several items preserves the previous whole-cell total" */
    it.each([
      false,
      true,
    ])("rewinds both revisions with reversed delivery %s", (reverse) => {
      const opening = [
        observedEvent({
          restatementKey: "a",
          costNanoMinor: 10_000_000_000,
          observedAtMs: FIRST_PULL,
        }),
        observedEvent({
          restatementKey: "b",
          costNanoMinor: 20_000_000_000,
          observedAtMs: FIRST_PULL,
        }),
      ];
      const revisions = [
        observedEvent({
          restatementKey: "a",
          costNanoMinor: 15_000_000_000,
          observedAtMs: SECOND_PULL,
        }),
        observedEvent({
          restatementKey: "b",
          costNanoMinor: 30_000_000_000,
          observedAtMs: SECOND_PULL,
        }),
      ];
      const state = fold([
        ...opening,
        ...(reverse ? revisions.reverse() : revisions),
      ]);
      expect(state.previousAmountNanoUsd).toBe(30_000_000_000);
    });
  });

  describe("given the provider restates a day at a different amount", () => {
    /** @scenario "A restated day shows what it was before" */
    it("names the amount the day held before, and when the change was seen", () => {
      const state = fold([
        observedEvent({
          costNanoMinor: 12_340_000_000,
          observedAtMs: FIRST_PULL,
        }),
        observedEvent({
          costNanoMinor: 9_000_000_000,
          observedAtMs: SECOND_PULL,
        }),
      ]);

      expect(governanceCostRollupTotals(state).amountNanoUsd).toBe(
        9_000_000_000,
      );
      expect(state.previousAmountNanoUsd).toBe(12_340_000_000);
      expect(state.revisionCount).toBe(1);
      expect(state.revisedAt).toBe(SECOND_PULL);
    });
  });

  describe("given a later pull reports the same day at the same amount", () => {
    /** @scenario "A re-pull that confirms the same amount is not a revision" */
    it("does not call the confirmation a revision", () => {
      const state = fold([
        observedEvent({
          costNanoMinor: 12_340_000_000,
          observedAtMs: FIRST_PULL,
        }),
        observedEvent({
          costNanoMinor: 12_340_000_000,
          observedAtMs: SECOND_PULL,
        }),
      ]);

      // Otherwise the screen renders "revised, was $12.34" beside a figure of
      // $12.34 — a marker that contradicts the number it annotates.
      expect(state.revisedAt).toBe(null);
      expect(state.previousAmountNanoUsd).toBe(null);
      expect(state.revisionCount).toBe(0);
    });
  });

  describe("given a settled day is pulled again and nothing moved", () => {
    it("still says it was revised, and still names the same prior figure", () => {
      const CONFIRMING_PULL = Date.parse("2026-08-05T04:00:00.000Z");
      const state = fold([
        observedEvent({
          costNanoMinor: 12_340_000_000,
          observedAtMs: FIRST_PULL,
        }),
        observedEvent({
          costNanoMinor: 9_000_000_000,
          observedAtMs: SECOND_PULL,
        }),
        observedEvent({
          costNanoMinor: 9_000_000_000,
          observedAtMs: CONFIRMING_PULL,
        }),
      ]);

      // The day really was revised, and a later look that agrees with the
      // correction is not grounds to stop saying so.
      expect(state.revisedAt).toBe(SECOND_PULL);
      expect(state.previousAmountNanoUsd).toBe(12_340_000_000);
      // The anchor still moves — that pull did touch the day.
      expect(state.lastObservedAt).toBe(CONFIRMING_PULL);
    });
  });

  describe("given two different items in the cell are each restated", () => {
    // Two provider buckets land in one day x dimension cell, then both get
    // corrected. The stale guard is per item, so it never fires here — both
    // corrections are new to their OWN item however they are delivered.
    const OPEN_A = 10_000_000_000;
    const OPEN_B = 20_000_000_000;
    const NEW_A = 15_000_000_000;
    const NEW_B = 30_000_000_000;
    const RESTATED_A_AT = Date.parse("2026-08-03T04:00:00.000Z");
    const RESTATED_B_AT = Date.parse("2026-08-04T04:00:00.000Z");

    const opening = [
      observedEvent({
        costNanoMinor: OPEN_A,
        restatementKey: "bucket-a",
        observedAtMs: FIRST_PULL,
      }),
      observedEvent({
        costNanoMinor: OPEN_B,
        restatementKey: "bucket-b",
        observedAtMs: FIRST_PULL,
      }),
    ];
    const restatementOfA = observedEvent({
      costNanoMinor: NEW_A,
      restatementKey: "bucket-a",
      observedAtMs: RESTATED_A_AT,
    });
    const restatementOfB = observedEvent({
      costNanoMinor: NEW_B,
      restatementKey: "bucket-b",
      observedAtMs: RESTATED_B_AT,
    });

    it("reports the newest correction, whichever order the two arrive in", () => {
      const inOrder = fold([...opening, restatementOfA, restatementOfB]);
      const reversed = fold([...opening, restatementOfB, restatementOfA]);

      // B's correction is the newer of the two, so it is the one the cell
      // reports no matter which correction the log happens to deliver last.
      expect(inOrder.revisedAt).toBe(RESTATED_B_AT);
      expect(reversed.revisedAt).toBe(RESTATED_B_AT);
    });

    it("names the same prior figure, whichever order the two arrive in", () => {
      const inOrder = fold([...opening, restatementOfA, restatementOfB]);
      const reversed = fold([...opening, restatementOfB, restatementOfA]);

      // "was $X" means what the day held immediately before its newest
      // correction: A already corrected, B not yet. Deriving it from whatever
      // the running total happened to be when the last event landed made the
      // reversed delivery say $40 — a figure the day never held.
      const beforeNewestCorrection = NEW_A + OPEN_B;
      expect(inOrder.previousAmountNanoUsd).toBe(beforeNewestCorrection);
      expect(reversed.previousAmountNanoUsd).toBe(beforeNewestCorrection);
    });

    it("agrees on the total and the count either way", () => {
      const inOrder = fold([...opening, restatementOfA, restatementOfB]);
      const reversed = fold([...opening, restatementOfB, restatementOfA]);

      // These two were already order-independent; they are asserted so a fix
      // to the markers above cannot quietly break them.
      expect(governanceCostRollupTotals(inOrder).amountNanoUsd).toBe(
        NEW_A + NEW_B,
      );
      expect(governanceCostRollupTotals(reversed).amountNanoUsd).toBe(
        NEW_A + NEW_B,
      );
      expect(inOrder.revisionCount).toBe(2);
      expect(reversed.revisionCount).toBe(2);
    });
  });
});

describe("the last-observed anchor", () => {
  describe("given a later pull reports the same day at the same amount", () => {
    /** @scenario "A re-pull that confirms the same amount still refreshes the day" */
    it("moves the anchor to the confirming pull", () => {
      const state = fold([
        observedEvent({
          costNanoMinor: 12_340_000_000,
          observedAtMs: FIRST_PULL,
        }),
        observedEvent({
          costNanoMinor: 12_340_000_000,
          observedAtMs: SECOND_PULL,
        }),
      ]);

      // This observation is the ONLY thing that can ever let the day read as
      // settled: it is the pull that saw the provider stop moving it.
      expect(state.lastObservedAt).toBe(SECOND_PULL);
    });
  });

  describe("given an older observation of another item arrives last", () => {
    /** @scenario "Rebuilding after a stale observation is redelivered keeps the newer time" */
    it("keeps the newest pull rather than the last-delivered one", () => {
      const state = fold([
        observedEvent({
          costNanoMinor: 1_000,
          restatementKey: "bucket-a",
          observedAtMs: SECOND_PULL,
        }),
        observedEvent({
          costNanoMinor: 2_000,
          restatementKey: "bucket-b",
          observedAtMs: FIRST_PULL,
        }),
      ]);

      // The fold has no re-fold path and its events arrive in any order, so
      // the anchor has to be order-independent. The same-item guard would not
      // have caught this one: it is a different item.
      expect(state.lastObservedAt).toBe(SECOND_PULL);
    });
  });

  describe("given the same events are replayed", () => {
    /** @scenario "Replaying the event log reproduces when each day was last observed" */
    it("reproduces the anchor exactly, in any order and at any later time", () => {
      const events = [
        observedEvent({
          costNanoMinor: 12_340_000_000,
          observedAtMs: FIRST_PULL,
        }),
        observedEvent({
          costNanoMinor: 9_000_000_000,
          observedAtMs: SECOND_PULL,
        }),
      ];

      const original = fold(events);
      const replayed = fold([...events].reverse());

      // Reading the wall clock instead would stamp the replay with today,
      // breaking rebuild-equals-replay and letting a delete-then-replay
      // erasure flip a long-settled day back to changeable.
      expect(replayed.lastObservedAt).toBe(original.lastObservedAt);
      expect(replayed.lastObservedAt).toBe(SECOND_PULL);
      // Both anchors sit in the past of the run itself, which is the property
      // a clock read would violate.
      expect(original.lastObservedAt).toBeLessThan(Date.now());

      // The anchor is not the only field a replay has to reproduce. Asserting
      // it alone passed even while the revision markers below diverged by
      // delivery order, which is exactly how that defect stayed hidden.
      expect(replayed.revisedAt).toBe(original.revisedAt);
      expect(replayed.previousAmountNanoUsd).toBe(
        original.previousAmountNanoUsd,
      );
      // `revisionCount` is deliberately not asserted here. It counts the
      // deliveries that moved the figure, and recovering that count from a
      // log delivered newest-first needs every observation of the item, not
      // just the newest two. Left as its own decision rather than quietly
      // redefined into "how many items changed".
    });
  });
});

describe("the markers through storage", () => {
  describe("given a restated cell is written and read back", () => {
    it("round-trips both markers", () => {
      const state = fold([
        observedEvent({
          costNanoMinor: 12_340_000_000,
          observedAtMs: FIRST_PULL,
        }),
        observedEvent({
          costNanoMinor: 9_000_000_000,
          observedAtMs: SECOND_PULL,
        }),
      ]);

      const row = projectGovernanceCostRollupStateToRow({
        state,
        tenantId: TENANT,
        version: GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST,
        appliedEventIds: [],
      });

      // The columns are DateTime, so the row carries SECONDS while the state
      // carries milliseconds. A test asserting only the round-trip would pass
      // just as well if both sides were wrong in the same unit.
      expect(row.LastObservedAt).toBe(Math.floor(SECOND_PULL / 1000));
      expect(row.RevisedAt).toBe(Math.floor(SECOND_PULL / 1000));

      const restored = governanceCostRollupStateFromRow(row);
      expect(restored.lastObservedAt).toBe(state.lastObservedAt);
      expect(restored.revisedAt).toBe(state.revisedAt);
      expect(restored.previousAmountNanoUsd).toBe(12_340_000_000);
    });
  });

  describe("given a cell nothing has restated", () => {
    it("writes no revision date rather than a zero one", () => {
      const state = fold([
        observedEvent({
          costNanoMinor: 12_340_000_000,
          observedAtMs: FIRST_PULL,
        }),
      ]);

      const row = projectGovernanceCostRollupStateToRow({
        state,
        tenantId: TENANT,
        version: GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST,
        appliedEventIds: [],
      });

      // A zero date would render as 1970 and read as "revised long ago".
      expect(row.RevisedAt).toBe(null);
      expect(governanceCostRollupStateFromRow(row).revisedAt).toBe(null);
    });
  });

  describe("given a row written before the markers existed", () => {
    /** @scenario "A day summarized before the markers existed reads as settled" */
    it("reads as never observed and never revised", () => {
      const state = fold([
        observedEvent({
          costNanoMinor: 12_340_000_000,
          observedAtMs: FIRST_PULL,
        }),
      ]);
      const row = projectGovernanceCostRollupStateToRow({
        state,
        tenantId: TENANT,
        version: GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST,
        appliedEventIds: [],
      });

      // What the ALTER's defaults put on every pre-existing row.
      const backfilled = governanceCostRollupStateFromRow({
        ...row,
        RevisedAt: null,
        LastObservedAt: 0,
      });

      expect(backfilled.revisedAt).toBe(null);
      expect(backfilled.lastObservedAt).toBe(0);
    });
  });
});

describe("a correction that lands in a different cell", () => {
  // The dimensions a charge is deliberately NOT identified by. A correction
  // arriving under one of these lands in a cell of its own, leaving the first
  // version behind holding its money with nothing to say it was superseded -
  // and a total across the day then carries the same bill twice.
  const BILLED = 10_000_000_000;
  const REISSUED = 11_000_000_000;

  describe("when the provider reissues the same bill in another currency", () => {
    /** @scenario "A correction that arrives under a different currency retracts what it replaces" */
    it("empties the cell the first currency held and leaves the money in the second", () => {
      const inEuros = observedEvent({
        costNanoMinor: BILLED,
        currencyCode: "EUR",
        observedAtMs: FIRST_PULL,
        id: "evt-pulled-eur",
      });
      const retraction = retractionEvent({
        currencyCode: "EUR",
        observedAtMs: SECOND_PULL,
      });
      const inDollars = observedEvent({
        costNanoMinor: REISSUED,
        currencyCode: GOVERNANCE_COST_CURRENCY_USD,
        observedAtMs: SECOND_PULL,
        id: "evt-pulled-usd",
      });

      const retracted = fold([inEuros, retraction]);
      const reissued = fold([inDollars]);

      // Retracted by an EVENT rather than by editing the earlier row: the
      // summary is a consequence of the event history, so a fix that only
      // reaches storage is undone by the next rebuild.
      expect(governanceCostRollupTotals(retracted).amountNanoMinor).toBe(0);
      expect(retracted.revisionCount).toBe(1);
      expect(retracted.lastObservedAt).toBe(SECOND_PULL);
      expect(governanceCostRollupTotals(reissued).amountNanoMinor).toBe(
        REISSUED,
      );

      // The retraction has to ADDRESS the cell it retracts. Currency is part
      // of the key, so a retraction routed by the reissued currency would
      // empty the wrong cell and leave both versions live.
      expect(governanceCostRollupKey(retraction)).toBe(
        governanceCostRollupKey(inEuros),
      );
      expect(governanceCostRollupKey(inDollars)).not.toBe(
        governanceCostRollupKey(inEuros),
      );
    });
  });

  describe("when the provider reissues the same charge against another spender", () => {
    /** @scenario "A correction that arrives against a different spender retracts what it replaces" */
    it("empties the cell the first spender held and leaves the money against the second", () => {
      const againstFirst = observedEvent({
        costNanoMinor: BILLED,
        rawActorId: "user_ada",
        observedAtMs: FIRST_PULL,
        id: "evt-pulled-ada",
      });
      const retraction = retractionEvent({
        rawActorId: "user_ada",
        observedAtMs: SECOND_PULL,
      });
      const againstSecond = observedEvent({
        costNanoMinor: REISSUED,
        rawActorId: "user_grace",
        observedAtMs: SECOND_PULL,
        id: "evt-pulled-grace",
      });

      const retracted = fold([againstFirst, retraction]);
      const reissued = fold([againstSecond]);

      // The same defect reached by a different door: fixing only the currency
      // case leaves this one and the agent one open behind it.
      expect(governanceCostRollupTotals(retracted).amountNanoUsd).toBe(0);
      expect(retracted.revisionCount).toBe(1);
      expect(retracted.lastObservedAt).toBe(SECOND_PULL);
      expect(governanceCostRollupTotals(reissued).amountNanoUsd).toBe(REISSUED);

      expect(governanceCostRollupKey(retraction)).toBe(
        governanceCostRollupKey(againstFirst),
      );
      expect(governanceCostRollupKey(againstSecond)).not.toBe(
        governanceCostRollupKey(againstFirst),
      );
    });
  });

  // Not a bound scenario, and deliberately so: this is a control on the ONE
  // reader that has no ordering to give. The daily comparator re-derives a day
  // by folding whatever `findCostEventsForDay` hands back, which is a GROUP BY
  // with no ORDER BY on it, so the retraction reaching the fold BEFORE the
  // observation it withdraws is an ordinary case there rather than a corner.
  //
  // Fold the retraction first without this and the observation behind it puts
  // the money back, so the comparator reports the day as disagreeing with its
  // own history on every run for as long as the day is kept -- a permanent
  // false alarm on the one alert that says the money on the screen is wrong.
  describe("when the log hands the retraction back before the observation", () => {
    it("reaches the same emptied cell either way round", () => {
      const observed = observedEvent({
        costNanoMinor: BILLED,
        observedAtMs: FIRST_PULL,
        id: "evt-pulled-first",
      });
      const retraction = retractionEvent({ observedAtMs: SECOND_PULL });

      const inOrder = fold([observed, retraction]);
      const reversed = fold([retraction, observed]);

      expect(governanceCostRollupTotals(inOrder).amountNanoMinor).toBe(0);
      expect(governanceCostRollupTotals(reversed).amountNanoMinor).toBe(0);

      // Zeroed rather than dropped in both orders. An item removed instead
      // reads as "we hold no figure", which withholds the whole day's total.
      expect(governanceCostRollupTotals(reversed).amountNanoUsd).toBe(0);

      // Both orders name the same thing as what the cell held before, so the
      // "revised, was $X" copy does not depend on delivery order either.
      expect(reversed.previousAmountNanoUsd).toBe(
        inOrder.previousAmountNanoUsd,
      );
      expect(reversed.revisedAt).toBe(inOrder.revisedAt);
      expect(reversed.lastObservedAt).toBe(SECOND_PULL);

      // `revisionCount` is the one field that does NOT converge, and the
      // state's own doc says why: it counts the deliveries that moved the
      // figure, and a retraction arriving first has nothing to move. Pinned
      // rather than left out, because the next reader to notice the omission
      // adds an equality here and gets a red test with nothing to explain it.
      // Nothing renders this counter; everything a customer reads is above.
      expect(inOrder.revisionCount).toBe(1);
      expect(reversed.revisionCount).toBe(0);
    });

    // Also deliberately unbound: the same control at the one instant where
    // the two orders used to reach different MONEY rather than a different
    // internal counter. The comparator's re-derivation has no ordering to
    // give, so a provider stamping a correction with the pull instant it
    // corrects decided whether the day read as drifting by which row the
    // GROUP BY returned first.
    it("empties the cell either way round when both carry one pull instant", () => {
      const observed = observedEvent({
        costNanoMinor: BILLED,
        observedAtMs: SECOND_PULL,
        id: "evt-pulled-tie",
      });
      const retraction = retractionEvent({ observedAtMs: SECOND_PULL });

      expect(
        governanceCostRollupTotals(fold([observed, retraction]))
          .amountNanoMinor,
      ).toBe(0);
      expect(
        governanceCostRollupTotals(fold([retraction, observed]))
          .amountNanoMinor,
      ).toBe(0);

      // The withdrawal is what a re-delivered retraction must not undo: it is
      // applied rather than skipped at an equal instant, so it has to stay a
      // no-op in substance when the queue hands it over twice.
      expect(
        governanceCostRollupTotals(fold([observed, retraction, retraction]))
          .amountNanoMinor,
      ).toBe(0);
      expect(fold([observed, retraction, retraction]).revisionCount).toBe(
        fold([observed, retraction]).revisionCount,
      );
    });
  });
});
