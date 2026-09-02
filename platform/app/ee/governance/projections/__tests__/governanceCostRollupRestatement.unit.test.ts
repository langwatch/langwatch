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
  id = `evt-pulled-${observedAtMs}-${restatementKey}`,
}: {
  costNanoMinor: number;
  observedAtMs: number;
  restatementKey?: string;
  currencyCode?: string;
  costNanoUsd?: number | null;
  occurredAtMs?: number;
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
      rateVersion: "registry@2026-08-01",
      costBasis: "computed",
      costStatus: "estimate",
      occurredAtMs,
      observedAtMs,
    },
  } as never;
}

/** One priced gateway outcome, as the ingest seam appends it. */
function confirmedEvent({
  costNanoUsd,
  occurredAt = DAY_MS,
  id = `evt-gw-${occurredAt}`,
}: {
  costNanoUsd: number;
  occurredAt?: number;
  id?: string;
}) {
  return {
    id,
    type: "lw.gateway.spend.confirmed",
    tenantId: TENANT,
    aggregateId: `gwreq-${id}`,
    occurredAt,
    data: {
      gateway_request_id: `gwreq-${id}`,
      occurred_at: occurredAt,
      tenantId: TENANT,
      organization_id: "org_acme",
      virtual_key_id: "vk_1",
      principal_user_id: "user_ada",
      end_user_id: "",
      trace_id: "",
      request_type: "chat",
      labels: [],
      metadata: "",
      admitted_at: occurredAt,
      team_id: "",
      model: "openai/gpt-5-mini",
      model_provider_id: "openai",
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        reasoning_tokens: 0,
        input_audio_tokens: 0,
        output_audio_tokens: 0,
        input_chars: 0,
      },
      rate_version: "registry@2026-08-01",
      duration_ms: 120,
      cost_nano_usd: costNanoUsd,
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

  describe("given a gateway outcome", () => {
    it("never marks the day revised, because nothing restates one", () => {
      const state = fold([
        confirmedEvent({ costNanoUsd: 5_000, id: "a" }),
        confirmedEvent({ costNanoUsd: 7_000, id: "b" }),
      ]);

      expect(governanceCostRollupTotals(state).amountNanoUsd).toBe(12_000);
      expect(state.revisedAt).toBe(null);
      expect(state.revisionCount).toBe(0);
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
    });
  });

  describe("given a gateway outcome", () => {
    it("anchors on the moment the request was served", () => {
      const served = Date.parse("2026-08-01T18:00:00.000Z");
      const state = fold([
        confirmedEvent({ costNanoUsd: 5_000, occurredAt: served }),
      ]);

      // We metered it as we served it, so serving time IS observation time
      // here. The read side exempts the lane from the provisional marker
      // outright rather than relying on this arithmetic.
      expect(state.lastObservedAt).toBe(served);
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
