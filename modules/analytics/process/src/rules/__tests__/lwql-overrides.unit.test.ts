/**
 * Verify the catalogue gates the columns it must, and the dataset overrides name real columns
 * and dedup as their engines require.
 */

import { describe, expect, it } from "vitest";

import { AUDIT_OVERRIDES } from "../lwql-audit-overrides.rules.ts";
import type { LwqlCatalogue } from "../lwql-catalogue.rules.ts";
import columnsManifest from "../lwql-columns-manifest.generated.json" with { type: "json" };
import { EXPERIMENTS_OVERRIDES } from "../lwql-experiments-overrides.rules.ts";
import { GATEWAY_OVERRIDES } from "../lwql-gateway-overrides.rules.ts";
import { GOVERNANCE_OVERRIDES } from "../lwql-governance-overrides.rules.ts";
import { METRICS_OVERRIDES } from "../lwql-metrics-overrides.rules.ts";
import { LWQL_CLICKHOUSE_CATALOGUE } from "../lwql-view-catalog.rules.ts";

const ALL_OVERRIDES = {
  ...EXPERIMENTS_OVERRIDES,
  ...METRICS_OVERRIDES,
  ...GATEWAY_OVERRIDES,
  ...AUDIT_OVERRIDES,
  ...GOVERNANCE_OVERRIDES,
};

describe("Dataset overrides", () => {
  describe("given the catalogue's column gates", () => {
    const COST = { access: { allOf: ["cost:view"] } };
    it.each([
      ["experiment_items", "Predicted", { content: "output" }],
      ["experiment_items", "TargetError", { content: "output" }],
      ["experiment_items", "EvaluationDetails", { content: "output" }],
      ["experiment_items", "EvaluationInputs", { content: "input" }],
      ["experiment_items", "DatasetEntry", { content: "input" }],
      ["experiment_items", "TargetCost", COST],
      ["experiment_items", "EvaluationCost", COST],
      ["experiment_run_results", "TotalCost", COST],
      ["dspy_optimizer_steps", "Predictors", { content: "output" }],
      ["dspy_optimizer_steps", "Examples", { content: "output" }],
      ["dspy_optimizer_steps", "LlmCalls", { content: "output" }],
      ["dspy_optimizer_steps", "OptimizerParameters", { content: "output" }],
      ["dspy_optimizer_steps", "LlmCallsTotalCost", COST],
      ["gateway_request_spend", "CostNanoUSD", COST],
      ["gateway_budget_ledger", "AmountUSD", COST],
      ["gateway_budget_ledger", "AmountNanoUSD", COST],
      ["governance_daily_cost_rollup", "AmountNanoMinor", COST],
      ["governance_security_events", "RawOcsfJson", { content: "output" }],
    ])("%s.%s is gated", (view, column, entry) => {
      const catalogue: LwqlCatalogue = LWQL_CLICKHOUSE_CATALOGUE;
      expect(catalogue[view]?.columns[column]).toEqual(entry);
    });
  });

  describe("given the dedup configuration", () => {
    it("marks each AggregatingMergeTree rollup dataset aggregating", () => {
      // gateway_budget_scope_totals and simulation_run_metrics_rollup are
      // AggregatingMergeTree sources: the builder finalises their
      // AggregateFunction states with merge combinators under a GROUP BY —
      // which only fires when the override declares it.
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

  describe("given the manifest", () => {
    it("all overridden tables exist in the manifest", () => {
      const manifestTableNames = new Set(columnsManifest.tables.map((t) => t.name));
      for (const table of Object.keys(ALL_OVERRIDES)) {
        expect(
          manifestTableNames.has(table),
          `table "${table}" referenced in overrides but not in manifest`,
        ).toBe(true);
      }
    });

    it("timeColumn overrides reference existing columns", () => {
      const tablesByName = new Map(columnsManifest.tables.map((t) => [t.name, t]));
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
