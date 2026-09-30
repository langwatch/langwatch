// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { describe, expect, it } from "vitest";

import {
  DAY_START_MS,
  HOUR_MS,
  observed,
  retracted,
  rollupFold,
  TENANT_ID,
} from "../../eventing/__tests__/governance-cost-rollup.fixtures.ts";
import { GovernanceCostChargeMapProjection } from "../../eventing/governance-cost-charge.projection.ts";
import type { GovernanceCostChargeRow } from "../../repositories/governance-cost-charge.repository.ts";
import type { GovernanceCostRollupRow } from "../../repositories/governance-cost-rollup.repository.ts";
import { MemoryGovernanceCostChargeRepository } from "../../repositories/memory/memory.governance-cost-charge.repository.ts";
import {
  compareCostRollupDay,
  computeCostRollupLagMs,
  deriveCostRollupCells,
} from "../cost-rollup-day-comparison.rules.ts";
import {
  governanceCostRollupTotals,
  type GovernanceCostRollupState,
} from "../governance-cost-rollup-cell.rules.ts";

const DAY = "2026-09-01";

type ChargeEvent = Parameters<ReturnType<typeof rollupFold>["fold"]>[0][number];

/** The stored row a fold of these charges would have written, with the amount the test names. */
function rowOf({
  state,
  amountNanoMinor,
  lastEventOccurredAt,
}: {
  state: GovernanceCostRollupState;
  amountNanoMinor: number;
  lastEventOccurredAt: number;
}): GovernanceCostRollupRow {
  return {
    TenantId: TENANT_ID,
    Day: state.day,
    CostSource: "pulled",
    IngestionSourceId: state.ingestionSourceId,
    Provider: state.provider,
    Model: state.model,
    AgentId: state.agentId,
    CurrencyCode: state.currencyCode,
    RawActorId: state.rawActorId,
    OrganizationId: state.organizationId,
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
    LastObservedAt: 0,
    PulledItemsJson: "{}",
    Version: "",
    AppliedEventIds: [],
    CreatedAt: 0,
    LastEventOccurredAt: lastEventOccurredAt,
    EventTimestamp: 0,
  };
}

/** The charge record's rows for these events, filed under the fold's own cells. */
function chargesOf(events: readonly ChargeEvent[]): GovernanceCostChargeRow[] {
  const { projection } = rollupFold();
  const charges = GovernanceCostChargeMapProjection.create({
    store: MemoryGovernanceCostChargeRepository.create(),
    cells: projection,
  });
  return events.flatMap((event) => {
    const row = charges.map(event);
    return row === null ? [] : [row];
  });
}

function compare({
  events,
  summarizedAmount,
  summarizedAt,
}: {
  events: readonly ChargeEvent[];
  summarizedAmount: number;
  summarizedAt: number;
}) {
  const state = rollupFold().fold(events);
  const derived = deriveCostRollupCells(chargesOf(events));
  return {
    state,
    comparison: compareCostRollupDay({
      derived,
      summarizedRows: [
        rowOf({ state, amountNanoMinor: summarizedAmount, lastEventOccurredAt: summarizedAt }),
      ],
      latestEventOccurredAtMs: state.LastEventOccurredAt,
      latestSummarizedOccurredAtMs: summarizedAt,
      windowStartMs: Date.parse(`${DAY}T00:00:00.000Z`),
    }),
  };
}

describe("one comparison of a day against its summary", () => {
  describe("given a day whose summary covers every charge it holds", () => {
    /** @scenario A summary that covers every charge of the day is named as behind by nothing */
    it("names nothing as still folding and states no difference", () => {
      const charge = observed({ restatementKey: "item-1", costNanoMinor: 1_000 });
      const { state, comparison } = compare({
        events: [charge],
        summarizedAmount: 1_000,
        summarizedAt: DAY_START_MS + HOUR_MS,
      });

      expect(governanceCostRollupTotals(state).amountNanoMinor).toBe(1_000);
      expect(comparison.behind).toEqual([]);
      expect(comparison.mismatches).toEqual([]);
    });
  });

  describe("given two charges on one cell stamped with the same moment", () => {
    /** @scenario A charge sharing its moment with a folded one leaves the watermarks level */
    it("names nothing as still folding and states the difference between the figures", () => {
      const first = observed({ restatementKey: "item-1", costNanoMinor: 1_000 });
      const second = observed({ restatementKey: "item-2", costNanoMinor: 500 });
      const { comparison } = compare({
        events: [first, second],
        summarizedAmount: 1_000,
        summarizedAt: DAY_START_MS,
      });

      expect(comparison.behind).toEqual([]);
      expect(comparison.mismatches).toHaveLength(1);
      expect(comparison.mismatches[0]).toMatchObject({
        summarizedNanoMinor: 1_000,
        derivedNanoMinor: 1_500,
      });
    });
  });

  describe("given a summary cell no charge accounts for", () => {
    it("states it as money the events do not explain", () => {
      const state = rollupFold().fold([observed({ restatementKey: "item-1" })]);
      const comparison = compareCostRollupDay({
        derived: new Map(),
        summarizedRows: [rowOf({ state, amountNanoMinor: 700, lastEventOccurredAt: DAY_START_MS })],
        latestEventOccurredAtMs: null,
        latestSummarizedOccurredAtMs: DAY_START_MS,
        windowStartMs: DAY_START_MS,
      });

      expect(comparison.mismatches).toEqual([
        expect.objectContaining({ summarizedNanoMinor: 700, derivedNanoMinor: null }),
      ]);
    });
  });
});

describe("the charge record states each cell as the fold does", () => {
  const later = DAY_START_MS + 2 * HOUR_MS;
  const histories: [string, ChargeEvent[]][] = [
    [
      "a re-pulled item replaced by its newer figure",
      [
        observed({ restatementKey: "item-1", costNanoMinor: 1_000 }),
        observed({ restatementKey: "item-1", costNanoMinor: 1_400, observedAtMs: later }),
        observed({ restatementKey: "item-2", costNanoMinor: 300 }),
      ],
    ],
    [
      "an older look arriving after the newer one",
      [
        observed({ restatementKey: "item-1", costNanoMinor: 1_400, observedAtMs: later }),
        observed({ restatementKey: "item-1", costNanoMinor: 1_000 }),
      ],
    ],
    [
      "an item withdrawn, before or after its figure",
      [
        observed({ restatementKey: "item-1", costNanoMinor: 900 }),
        retracted({ restatementKey: "item-1", observedAtMs: later }),
        observed({ restatementKey: "item-2", costNanoMinor: 200 }),
      ],
    ],
    [
      "a withdrawal and a figure stated at one moment",
      [
        retracted({ restatementKey: "item-1", observedAtMs: later }),
        observed({ restatementKey: "item-1", costNanoMinor: 700, observedAtMs: later }),
      ],
    ],
  ];

  describe.each(histories)("given %s", (_name, events) => {
    it("holds the money the fold holds, in either order", () => {
      for (const ordered of [events, events.toReversed()]) {
        const folded = governanceCostRollupTotals(rollupFold().fold(ordered)).amountNanoMinor;
        const [cell] = [...deriveCostRollupCells(chargesOf(ordered)).values()];

        expect(cell?.amountNanoMinor).toBe(folded);
      }
    });
  });
});

describe("how far the summary trails its events", () => {
  const windowStartMs = Date.parse(`${DAY}T00:00:00.000Z`);

  it("is zero when the log holds no events", () => {
    expect(
      computeCostRollupLagMs({
        latestEventOccurredAtMs: null,
        latestSummarizedOccurredAtMs: 5_000,
        windowStartMs,
      }),
    ).toBe(0);
  });

  it("is the whole distance from the window start when nothing is summarized", () => {
    expect(
      computeCostRollupLagMs({
        latestEventOccurredAtMs: windowStartMs + 9_000,
        latestSummarizedOccurredAtMs: null,
        windowStartMs,
      }),
    ).toBe(9_000);
  });

  it("is never negative when the summary is ahead", () => {
    expect(
      computeCostRollupLagMs({
        latestEventOccurredAtMs: 1_000,
        latestSummarizedOccurredAtMs: 4_000,
        windowStartMs,
      }),
    ).toBe(0);
  });
});
