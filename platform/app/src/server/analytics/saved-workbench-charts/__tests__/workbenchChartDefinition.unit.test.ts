/**
 * What a saved workbench chart's stored definition will and will not admit.
 *
 * The schema is the only way a row is ever read, so these are the claims that
 * decide whether a `Json` column can be trusted.
 *
 * @see specs/analytics/governed-sql-saved-charts.feature
 */

import { describe, expect, it } from "vitest";

import {
  WORKBENCH_CHART_DEFINITION_VERSION,
  workbenchChartDefinitionSchema,
} from "../workbenchChartDefinition";

const SQL = "SELECT count() AS value FROM analytics.traces";

const SPEC = {
  $schema: "https://vega.github.io/schema/vega-lite/v6.json",
  data: { name: "query_result" },
  mark: "bar",
};

describe("the saved workbench chart definition", () => {
  describe("given a definition holding SQL, parameter values and a specification", () => {
    describe("when it is read", () => {
      /** @scenario "A saved definition carries the query, its parameter values and its specification" */
      it("preserves all three and the version it was written in", () => {
        const parsed = workbenchChartDefinitionSchema.parse({
          version: WORKBENCH_CHART_DEFINITION_VERSION,
          sql: SQL,
          parameters: { since: "2026-02-01", limit: 10, exact: true },
          vegaLiteSpec: SPEC,
        });

        expect(parsed.sql).toBe(SQL);
        expect(parsed.parameters).toEqual({
          since: "2026-02-01",
          limit: 10,
          exact: true,
        });
        expect(parsed.vegaLiteSpec).toEqual(SPEC);
        expect(parsed.version).toBe(WORKBENCH_CHART_DEFINITION_VERSION);
      });
    });
  });

  describe("given a definition holding only SQL and its parameter values", () => {
    describe("when it is read", () => {
      /** @scenario "A chart saved without a hand-authored specification is the same record" */
      it("is accepted with no specification, and none is invented", () => {
        const parsed = workbenchChartDefinitionSchema.parse({
          version: WORKBENCH_CHART_DEFINITION_VERSION,
          sql: SQL,
        });

        expect(parsed.sql).toBe(SQL);
        expect(parsed.vegaLiteSpec).toBeUndefined();
        // An omitted parameter map is an empty one, not a missing key that
        // every reader downstream would have to remember to guard.
        expect(parsed.parameters).toEqual({});
      });
    });
  });

  describe("given a definition whose parameter values are not scalars", () => {
    describe("when it is read", () => {
      /** @scenario "A parameter value that is not a scalar is refused" */
      it("refuses the object and the array, and admits the scalars", () => {
        const withObject = workbenchChartDefinitionSchema.safeParse({
          version: WORKBENCH_CHART_DEFINITION_VERSION,
          sql: SQL,
          parameters: { since: { gte: "2026-02-01" } },
        });
        const withArray = workbenchChartDefinitionSchema.safeParse({
          version: WORKBENCH_CHART_DEFINITION_VERSION,
          sql: SQL,
          parameters: { ids: ["a", "b"] },
        });

        expect(withObject.success).toBe(false);
        expect(withArray.success).toBe(false);

        // The same values the query endpoint binds are the ones stored, so a
        // saved chart cannot carry one that would only fail when opened.
        expect(
          workbenchChartDefinitionSchema.safeParse({
            version: WORKBENCH_CHART_DEFINITION_VERSION,
            sql: SQL,
            parameters: {
              text: "a",
              number: 1,
              flag: false,
              nothing: null,
            },
          }).success,
        ).toBe(true);
      });
    });
  });

  describe("given a stored definition declaring an unknown version", () => {
    describe("when it is read", () => {
      /** @scenario "A definition written in an unknown version is refused rather than guessed at" */
      it("refuses it instead of reinterpreting it as the current version", () => {
        const future = workbenchChartDefinitionSchema.safeParse({
          version: WORKBENCH_CHART_DEFINITION_VERSION + 1,
          sql: SQL,
        });
        const missing = workbenchChartDefinitionSchema.safeParse({ sql: SQL });

        expect(future.success).toBe(false);
        expect(missing.success).toBe(false);
      });
    });
  });

  describe("given a definition with no statement in it", () => {
    describe("when it is read", () => {
      it("refuses an empty query rather than storing a chart of nothing", () => {
        expect(
          workbenchChartDefinitionSchema.safeParse({
            version: WORKBENCH_CHART_DEFINITION_VERSION,
            sql: "",
          }).success,
        ).toBe(false);
      });
    });
  });
});
