/**
 * Verify column gates in dataset overrides match the manifest columns and
 * expected gating rules.
 */

import { describe, expect, it } from "vitest";
import columnsManifest from "../columnsManifest.generated.json";
import { AUDIT_OVERRIDES } from "../overrides/audit";
import { EXPERIMENTS_OVERRIDES } from "../overrides/experiments";
import { GATEWAY_OVERRIDES } from "../overrides/gateway";
import { GOVERNANCE_OVERRIDES } from "../overrides/governance";
import { METRICS_OVERRIDES } from "../overrides/metrics";

const ALL_OVERRIDES = {
  ...EXPERIMENTS_OVERRIDES,
  ...METRICS_OVERRIDES,
  ...GATEWAY_OVERRIDES,
  ...AUDIT_OVERRIDES,
  ...GOVERNANCE_OVERRIDES,
};

/** Narrows an optional override lookup to defined, failing loudly if absent. */
function overrideFor<T>(
  overrides: Record<string, T | undefined>,
  name: string,
): T {
  const override = overrides[name];
  if (!override) {
    throw new Error(`expected override "${name}" to exist`);
  }
  return override;
}

describe("Dataset overrides", () => {
  describe("column gates", () => {
    it("experiment_run_items.Predicted is gated output", () => {
      const override = overrideFor(
        EXPERIMENTS_OVERRIDES,
        "experiment_run_items",
      );
      expect(override.columnGates?.Predicted).toEqual(["output"]);
    });

    it("experiment_run_items.TargetError is gated output", () => {
      const override = overrideFor(
        EXPERIMENTS_OVERRIDES,
        "experiment_run_items",
      );
      expect(override.columnGates?.TargetError).toEqual(["output"]);
    });

    it("experiment_run_items.EvaluationDetails is gated output", () => {
      const override = overrideFor(
        EXPERIMENTS_OVERRIDES,
        "experiment_run_items",
      );
      expect(override.columnGates?.EvaluationDetails).toEqual(["output"]);
    });

    it("experiment_run_items.EvaluationInputs is gated input", () => {
      const override = overrideFor(
        EXPERIMENTS_OVERRIDES,
        "experiment_run_items",
      );
      expect(override.columnGates?.EvaluationInputs).toEqual(["input"]);
    });

    it("experiment_run_items.DatasetEntry is gated input", () => {
      const override = overrideFor(
        EXPERIMENTS_OVERRIDES,
        "experiment_run_items",
      );
      expect(override.columnGates?.DatasetEntry).toEqual(["input"]);
    });

    it("experiment_run_items.TargetCost is gated costs", () => {
      const override = overrideFor(
        EXPERIMENTS_OVERRIDES,
        "experiment_run_items",
      );
      expect(override.columnGates?.TargetCost).toEqual(["costs"]);
    });

    it("experiment_run_items.EvaluationCost is gated costs", () => {
      const override = overrideFor(
        EXPERIMENTS_OVERRIDES,
        "experiment_run_items",
      );
      expect(override.columnGates?.EvaluationCost).toEqual(["costs"]);
    });

    it("experiment_runs.TotalCost is gated costs", () => {
      const override = overrideFor(EXPERIMENTS_OVERRIDES, "experiment_runs");
      expect(override.columnGates?.TotalCost).toEqual(["costs"]);
    });

    it("dspy_steps.Predictors is gated output", () => {
      const override = overrideFor(EXPERIMENTS_OVERRIDES, "dspy_steps");
      expect(override.columnGates?.Predictors).toEqual(["output"]);
    });

    it("dspy_steps.Examples is gated output", () => {
      const override = overrideFor(EXPERIMENTS_OVERRIDES, "dspy_steps");
      expect(override.columnGates?.Examples).toEqual(["output"]);
    });

    it("dspy_steps.LlmCalls is gated output", () => {
      const override = overrideFor(EXPERIMENTS_OVERRIDES, "dspy_steps");
      expect(override.columnGates?.LlmCalls).toEqual(["output"]);
    });

    it("dspy_steps.OptimizerParameters is gated output", () => {
      const override = overrideFor(EXPERIMENTS_OVERRIDES, "dspy_steps");
      expect(override.columnGates?.OptimizerParameters).toEqual(["output"]);
    });

    it("dspy_steps.LlmCallsTotalCost is gated costs", () => {
      const override = overrideFor(EXPERIMENTS_OVERRIDES, "dspy_steps");
      expect(override.columnGates?.LlmCallsTotalCost).toEqual(["costs"]);
    });

    it("gateway_spend.CostNanoUSD is gated costs", () => {
      const override = overrideFor(GATEWAY_OVERRIDES, "gateway_spend");
      expect(override.columnGates?.CostNanoUSD).toEqual(["costs"]);
    });

    it("gateway_budget_ledger_events.AmountUSD is gated costs", () => {
      const override = overrideFor(
        GATEWAY_OVERRIDES,
        "gateway_budget_ledger_events",
      );
      expect(override.columnGates?.AmountUSD).toEqual(["costs"]);
    });

    it("gateway_budget_ledger_events.AmountNanoUSD is gated costs", () => {
      const override = overrideFor(
        GATEWAY_OVERRIDES,
        "gateway_budget_ledger_events",
      );
      expect(override.columnGates?.AmountNanoUSD).toEqual(["costs"]);
    });

    it("governance_cost_rollup_1d.AmountNanoMinor is gated costs", () => {
      const override = overrideFor(
        GOVERNANCE_OVERRIDES,
        "governance_cost_rollup_1d",
      );
      expect(override.columnGates?.AmountNanoMinor).toEqual(["costs"]);
    });

    it("governance_ocsf_events.RawOcsfJson is gated output", () => {
      const override = overrideFor(
        GOVERNANCE_OVERRIDES,
        "governance_ocsf_events",
      );
      expect(override.columnGates?.RawOcsfJson).toEqual(["output"]);
    });
  });

  describe("dedup configuration", () => {
    // metric_time_rollups, simulation_run_metrics_rollup and
    // gateway_budget_scope_totals are AggregatingMergeTree sources whose
    // AggregateFunction-state columns the derived builder cannot merge without
    // help — they are on the include list (../includedTables.ts) and their
    // override declares the aggregating dedup that finalises those states.
    it("marks each AggregatingMergeTree rollup dataset aggregating", () => {
      // These were skipped as a follow-up; they are now catalogued, and the
      // builder finalises their AggregateFunction states with merge combinators
      // under a GROUP BY — which only fires when the override declares it.
      expect(GATEWAY_OVERRIDES.gateway_budget_scope_totals?.dedup).toEqual({
        aggregating: true,
      });
      expect(METRICS_OVERRIDES.simulation_run_metrics_rollup?.dedup).toEqual({
        aggregating: true,
      });
    });

    it("dedups the ReplacingMergeTree time rollup on its version, not by merging", () => {
      // metric_time_rollups is a ReplacingMergeTree despite its name — the
      // latest version wins, so it takes a version column, not an aggregating
      // GROUP BY.
      expect(METRICS_OVERRIDES.metric_time_rollups?.dedup).toEqual({
        versionColumn: "UpdatedAt",
      });
    });
  });

  describe("manifest consistency", () => {
    it("all overridden tables exist in the manifest", () => {
      const manifestTableNames = new Set(
        columnsManifest.tables.map((t) => t.name),
      );
      for (const table of Object.keys(ALL_OVERRIDES)) {
        expect(
          manifestTableNames.has(table),
          `table "${table}" referenced in overrides but not in manifest`,
        ).toBe(true);
      }
    });

    it("all override column gates reference existing columns", () => {
      const tablesByName = new Map(
        columnsManifest.tables.map((t) => [t.name, t]),
      );
      for (const [tableName, override] of Object.entries(ALL_OVERRIDES)) {
        if (!override.columnGates) continue;
        const table = tablesByName.get(tableName);
        if (!table) continue;
        const columnNames = new Set(table.columns.map((c) => c.name));
        for (const columnName of Object.keys(override.columnGates)) {
          expect(
            columnNames.has(columnName),
            `override for "${tableName}": columnGates names "${columnName}", which does not exist in the table`,
          ).toBe(true);
        }
      }
    });

    it("timeColumn overrides reference existing columns", () => {
      const tablesByName = new Map(
        columnsManifest.tables.map((t) => [t.name, t]),
      );
      for (const [tableName, override] of Object.entries(ALL_OVERRIDES)) {
        if (!override.timeColumn) continue;
        const table = tablesByName.get(tableName);
        if (!table) continue;
        const columnNames = new Set(table.columns.map((c) => c.name));
        expect(
          columnNames.has(override.timeColumn),
          `override for "${tableName}": timeColumn names "${override.timeColumn}", which does not exist in the table`,
        ).toBe(true);
      }
    });
  });
});
