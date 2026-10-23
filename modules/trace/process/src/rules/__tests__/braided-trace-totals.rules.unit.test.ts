/**
 * The trace header's braided totals (ADR-185 §5). Spec: modules/trace/specs/braided-spans.feature
 */
import { describe, expect, it } from "vitest";

import {
  type BraidedSpanGroup,
  braidedOwnerTotalsOf,
  braidedTraceSummaryOf,
} from "../braided-trace-totals.rules.ts";

const READER = "proj_orchestrator";
const group = (overrides: Partial<BraidedSpanGroup>): BraidedSpanGroup => ({
  tenantId: "proj_specialists",
  spanCount: 1,
  startMs: 1_000,
  endMs: 1_100,
  inputTokens: 0,
  outputTokens: 0,
  explicitCost: 0,
  costInput: null,
  ...overrides,
});
const ownHeader = {
  timestamp: 1_000,
  durationMs: 500,
  spanCount: 4,
  totalCost: 0.01,
  inputTokens: 200,
  outputTokens: 100,
};

describe("braidedOwnerTotalsOf", () => {
  describe("given groups from the reader and two owners", () => {
    const totals = braidedOwnerTotalsOf({
      groups: [
        group({ tenantId: READER, spanCount: 9, explicitCost: 5 }),
        group({ tenantId: "proj_search", startMs: 1_300, endMs: 1_400, explicitCost: 0.02 }),
        group({ spanCount: 2, startMs: 1_200, endMs: 1_900, inputTokens: 30, explicitCost: 0.1 }),
        group({
          startMs: 1_100,
          endMs: 1_250,
          outputTokens: 7,
          costInput: { attrs: {}, model: "gpt-5", promptTokens: 0, completionTokens: 7 },
        }),
      ],
      readerProjectId: READER,
      priceOf: ({ completionTokens }) => (completionTokens ?? 0) / 100,
    });

    it("leaves the reader's own spans out", () => {
      expect(totals.map((owner) => owner.ownerProjectId)).not.toContain(READER);
    });

    it("adds each owner's groups up, pricing the spans that state no cost", () => {
      expect(totals[0]).toEqual({
        ownerProjectId: "proj_specialists",
        spanCount: 3,
        startMs: 1_100,
        endMs: 1_900,
        cost: 0.17,
        inputTokens: 30,
        outputTokens: 7,
      });
    });

    it("orders owners by their first span", () => {
      expect(totals.map((owner) => owner.ownerProjectId)).toEqual([
        "proj_specialists",
        "proj_search",
      ]);
    });
  });
});

describe("braidedTraceSummaryOf", () => {
  const owners = [{ projectId: "proj_specialists", name: "Specialists", canOpen: false }];
  const totals = [
    {
      ownerProjectId: "proj_specialists",
      spanCount: 3,
      startMs: 1_100,
      endMs: 2_000,
      cost: 0.04,
      inputTokens: 1_000,
      outputTokens: 500,
    },
  ];

  describe("given braided spans with their own cost and tokens", () => {
    /** @scenario "The trace header's totals include braided spans and say so" */
    it("adds them to the trace's own totals and names their owners", () => {
      expect(
        braidedTraceSummaryOf({ header: ownHeader, owners, totals, canSeeCosts: true }),
      ).toEqual({
        owners,
        spanCount: 7,
        durationMs: 1_000,
        cost: 0.05,
        inputTokens: 1_200,
        outputTokens: 600,
      });
    });
  });

  describe("given a viewer without cost:view", () => {
    it("shows no cost", () => {
      expect(
        braidedTraceSummaryOf({ header: ownHeader, owners, totals, canSeeCosts: false }).cost,
      ).toBeNull();
    });
  });

  describe("given neither the trace nor its braided spans carry tokens", () => {
    it("shows no tokens rather than zero", () => {
      const summary = braidedTraceSummaryOf({
        header: { ...ownHeader, inputTokens: null, outputTokens: null },
        owners,
        totals: [{ ...totals[0]!, inputTokens: 0, outputTokens: 0 }],
        canSeeCosts: true,
      });
      expect(summary.inputTokens).toBeNull();
      expect(summary.outputTokens).toBeNull();
    });
  });
});
