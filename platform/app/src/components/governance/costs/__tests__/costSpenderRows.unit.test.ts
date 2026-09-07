/**
 * The display logic behind the billed-spend-by-person panel.
 *
 * What matters here is honesty, not geometry: the bucket row must carry the
 * screen's own copy rather than an invented person, a withheld figure must
 * stay withheld (no bar, no number), and the agent must survive the trip so a
 * spender's two agents draw as two rows.
 *
 * Spec: specs/governance/governance-cost-screen.feature
 *   Rule: Pulled spend says who spent it, in the words the identity screen uses
 */
import { describe, expect, it } from "vitest";

import {
  NOT_NAMED_LABEL,
  type SpenderRow,
  spenderDisplayRows,
} from "../CostSpenderPanel";

function row(overrides: Partial<SpenderRow> = {}): SpenderRow {
  return {
    provider: "openai_admin",
    rawActorId: "u_ada",
    label: "ada@acme.example",
    agentId: "",
    amountUsd: 4,
    cellsWithoutAmount: 0,
    ...overrides,
  };
}

describe("the spender display rows", () => {
  describe("given the not-named bucket row", () => {
    it("labels it with the screen's copy and styles it as a remainder", () => {
      const shown = spenderDisplayRows([
        row({ provider: "", rawActorId: "", label: null }),
      ]);

      expect(shown[0]?.label).toBe(NOT_NAMED_LABEL);
      expect(shown[0]?.notNamed).toBe(true);
    });
  });

  describe("given a spender whose figure is withheld", () => {
    it("draws no bar and keeps the amount null rather than zero", () => {
      const shown = spenderDisplayRows([
        row({ amountUsd: 8 }),
        row({ rawActorId: "u_grace", amountUsd: null, cellsWithoutAmount: 3 }),
      ]);

      const grace = shown.find((r) => r.key.includes("u_grace"));
      expect(grace?.amountUsd).toBeNull();
      expect(grace?.widthPct).toBe(0);
      expect(grace?.cellsWithoutAmount).toBe(3);
    });
  });

  describe("given the same person billed at two providers", () => {
    it("carries each row's provider so two rows with one label read as two providers, not a duplicate", () => {
      const shown = spenderDisplayRows([
        row({ provider: "openai_admin", amountUsd: 2 }),
        row({ provider: "databricks", amountUsd: 6 }),
      ]);

      expect(shown.map((r) => r.provider).sort()).toEqual([
        "databricks",
        "openai_admin",
      ]);
      expect(new Set(shown.map((r) => r.key)).size).toBe(2);
    });
  });

  describe("given one spender across two agents", () => {
    it("keeps the two pairings distinct, each with its own agent and figure", () => {
      const shown = spenderDisplayRows([
        row({ agentId: "space-1", amountUsd: 2 }),
        row({ agentId: "space-2", amountUsd: 6 }),
      ]);

      expect(shown).toHaveLength(2);
      expect(new Set(shown.map((r) => r.key)).size).toBe(2);
      expect(shown.map((r) => r.agentId).sort()).toEqual([
        "space-1",
        "space-2",
      ]);
    });
  });

  describe("given the service's ordering", () => {
    it("preserves it rather than re-ranking the bucket by its size", () => {
      // The service puts the bucket last even when it carries the most
      // money. A re-sort here would promote it to the top spender.
      const shown = spenderDisplayRows([
        row({ amountUsd: 1 }),
        row({ provider: "", rawActorId: "", label: null, amountUsd: 100 }),
      ]);

      expect(shown[shown.length - 1]?.notNamed).toBe(true);
      // And the bars scale against the largest figure wherever it sits.
      expect(shown[1]?.widthPct).toBe(100);
      expect(shown[0]?.widthPct).toBe(1);
    });
  });
});
