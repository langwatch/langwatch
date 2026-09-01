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

/** One priced gateway outcome, as the ingest seam appends it. */
function confirmedEvent({
  costNanoUsd,
  principalUserId = "user_ada",
  model = "openai/gpt-5-mini",
  occurredAt = DAY_MS,
  id = `evt-${costNanoUsd}-${principalUserId}`,
}: {
  costNanoUsd: number;
  principalUserId?: string;
  model?: string;
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
      principal_user_id: principalUserId,
      end_user_id: "",
      trace_id: "",
      request_type: "chat",
      labels: [],
      metadata: "",
      admitted_at: occurredAt,
      team_id: "",
      model,
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
  id = `evt-pulled-${observedAtMs}`,
}: {
  costNanoMinor: number;
  currencyCode?: string;
  costNanoUsd?: number | null;
  restatementKey?: string;
  observedAtMs: number;
  occurredAtMs?: number;
  costStatus?: "exact" | "estimate";
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
      costStatus,
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
  describe("given two gateway outcomes that differ only by spender", () => {
    /** @scenario "Two spenders with identical numbers stay two rows after compaction" */
    it("puts each spender in its own group", () => {
      const ada = governanceCostRollupKey(
        confirmedEvent({ costNanoUsd: 5_000, principalUserId: "user_ada" }),
      );
      const grace = governanceCostRollupKey(
        confirmedEvent({ costNanoUsd: 5_000, principalUserId: "user_grace" }),
      );
      expect(ada).not.toBe(grace);
    });
  });

  describe("given two outcomes on the same day and dimensions", () => {
    it("puts them in one group so the day is one row", () => {
      const morning = governanceCostRollupKey(
        confirmedEvent({
          costNanoUsd: 5_000,
          occurredAt: Date.parse("2026-08-01T01:00:00.000Z"),
          id: "a",
        }),
      );
      const evening = governanceCostRollupKey(
        confirmedEvent({
          costNanoUsd: 7_000,
          occurredAt: Date.parse("2026-08-01T23:59:59.000Z"),
          id: "b",
        }),
      );
      expect(morning).toBe(evening);
    });

    it("splits the group at the UTC day boundary", () => {
      const lastMoment = governanceCostRollupKey(
        confirmedEvent({
          costNanoUsd: 1,
          occurredAt: Date.parse("2026-08-01T23:59:59.999Z"),
          id: "a",
        }),
      );
      const firstMoment = governanceCostRollupKey(
        confirmedEvent({
          costNanoUsd: 1,
          occurredAt: Date.parse("2026-08-02T00:00:00.000Z"),
          id: "b",
        }),
      );
      expect(lastMoment).not.toBe(firstMoment);
    });
  });

  describe("given the same dimensions under two tenants", () => {
    it("never shares a group across tenants", () => {
      const mine = governanceCostRollupKey(confirmedEvent({ costNanoUsd: 1 }));
      const theirs = governanceCostRollupKey({
        ...(confirmedEvent({ costNanoUsd: 1 }) as never as Record<
          string,
          unknown
        >),
        tenantId: "proj_someone_else",
      } as never);
      expect(mine).not.toBe(theirs);
    });
  });

  describe("given a gateway event and a pulled event", () => {
    // The two lanes are two writers of one table. If they could ever address
    // the same row they would race and each would overwrite the other's total.
    it("never shares a group between the gateway and pulled lanes", () => {
      const gateway = governanceCostRollupKey(
        confirmedEvent({ costNanoUsd: 1 }),
      );
      const pulled = governanceCostRollupKey(
        observedEvent({ costNanoMinor: 1, observedAtMs: DAY_MS }),
      );
      expect(gateway).not.toBe(pulled);
    });
  });
});

describe("GovernanceCostRollupFoldProjection", () => {
  describe("given several gateway outcomes on one day and dimension combination", () => {
    /** @scenario "A day's spend lands as one summary row per dimension combination" */
    it("holds the sum of those outcomes as the day's amount", () => {
      const state = fold([
        confirmedEvent({ costNanoUsd: 5_000_000_000, id: "a" }),
        confirmedEvent({ costNanoUsd: 7_340_000_000, id: "b" }),
      ]);
      expect(governanceCostRollupTotals(state).amountNanoUsd).toBe(
        12_340_000_000,
      );
      expect(governanceCostRollupTotals(state).requestCount).toBe(2);
    });

    it("keeps the provider's business day, not the ingest day", () => {
      const state = fold([confirmedEvent({ costNanoUsd: 1_000 })]);
      expect(state.day).toBe("2026-08-01");
    });

    it("states the currency rather than leaving it implied", () => {
      const state = fold([confirmedEvent({ costNanoUsd: 1_000 })]);
      expect(state.currencyCode).toBe(GOVERNANCE_COST_CURRENCY_USD);
      expect(state.costSource).toBe(GOVERNANCE_COST_SOURCE.GATEWAY);
    });
  });

  describe("given a failed outcome that still consumed tokens", () => {
    // Partial usage before a mid-stream failure is real spend on several
    // providers, and the shipped budget ledger debits it (gatewayDebits mints
    // `debits:failed` as readily as `debits:confirmed`). The rollup counts the
    // same money the ledger charges for, or the two disagree by construction.
    it("counts the money a failure already cost", () => {
      const failed = {
        ...(confirmedEvent({ costNanoUsd: 900, id: "f" }) as never as Record<
          string,
          unknown
        >),
        type: "lw.gateway.spend.failed",
      } as never;
      (failed as unknown as { data: Record<string, unknown> }).data.error = {
        type: "provider_timeout",
        http_status: 504,
      };
      expect(governanceCostRollupTotals(fold([failed])).amountNanoUsd).toBe(
        900,
      );
    });
  });

  describe("given an admission or a settlement", () => {
    // Neither carries a cost, and their dimensions are pre-resolution — the
    // gateway only settles model and provider after dispatch — so grouping
    // them would file a permanent amount-less row beside the real one.
    it("does not react to the events that carry no money", () => {
      expect(projection().eventTypes).toEqual([
        "lw.gateway.spend.confirmed",
        "lw.gateway.spend.failed",
        "lw.obs.pulled_usage.observed",
      ]);
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
    // Both wave-1 producers emit USD. The rule still has to hold before the
    // first non-USD producer arrives, or it arrives to a table that has been
    // silently reading its figures as dollars.
    it("reports no dollar amount rather than passing the foreign figure off as dollars", () => {
      const state = fold([confirmedEvent({ costNanoUsd: 5_000 })]);
      const inEuros = { ...state, currencyCode: "EUR" };
      const totals = governanceCostRollupTotals(inEuros);
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
    // is one gateway request or one pulled item, never the day-wide group the
    // key names. A re-fold would therefore rebuild the day out of one
    // request's events and throw the rest of the day away. The fold's
    // accumulators commute and its restatement rule keys on data the event
    // carries (`observedAtMs`), so there is nothing a replay could derive.
    it("declines the out-of-order re-fold that would load the wrong population", () => {
      expect(projection().options.refoldOnOutOfOrder).toBe(false);
    });

    it("reaches the same total whichever order the outcomes arrive in", () => {
      const forwards = fold([
        confirmedEvent({
          costNanoUsd: 300,
          occurredAt: Date.parse("2026-08-01T01:00:00.000Z"),
          id: "a",
        }),
        confirmedEvent({
          costNanoUsd: 700,
          occurredAt: Date.parse("2026-08-01T02:00:00.000Z"),
          id: "b",
        }),
      ]);
      const backwards = fold([
        confirmedEvent({
          costNanoUsd: 700,
          occurredAt: Date.parse("2026-08-01T02:00:00.000Z"),
          id: "b",
        }),
        confirmedEvent({
          costNanoUsd: 300,
          occurredAt: Date.parse("2026-08-01T01:00:00.000Z"),
          id: "a",
        }),
      ]);
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
