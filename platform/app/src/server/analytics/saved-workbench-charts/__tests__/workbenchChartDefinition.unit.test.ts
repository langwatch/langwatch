/**
 * What a saved workbench chart's stored definition will and will not admit.
 *
 * The schema is the only way a row is ever read, so these are the claims that
 * decide whether a `Json` column can be trusted.
 *
 * @see specs/analytics/lwql-saved-charts.feature
 */

import { describe, expect, it } from "vitest";

import { MAX_LWQL_LENGTH } from "../../lwql/sqlText";
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

  describe("given a definition bigger than what is stored", () => {
    describe("when its statement is longer than the ceiling", () => {
      /** @scenario "A definition larger than the stored ceilings is refused" */
      it("refuses it as too big, at the ceiling the query endpoints enforce", () => {
        const overLong = workbenchChartDefinitionSchema.safeParse({
          version: WORKBENCH_CHART_DEFINITION_VERSION,
          sql: "x".repeat(MAX_LWQL_LENGTH + 1),
        });

        expect(overLong.success).toBe(false);
        expect(overLong.error?.issues).toContainEqual(
          expect.objectContaining({
            code: "too_big",
            maximum: MAX_LWQL_LENGTH,
            path: ["sql"],
          }),
        );

        // A statement exactly at the ceiling is one the query endpoints will
        // run, so refusing it here would lose a member's work.
        expect(
          workbenchChartDefinitionSchema.safeParse({
            version: WORKBENCH_CHART_DEFINITION_VERSION,
            sql: "x".repeat(MAX_LWQL_LENGTH),
          }).success,
        ).toBe(true);
      });
    });

    describe("when it binds more parameters than the ceiling", () => {
      /** @scenario "A definition larger than the stored ceilings is refused" */
      it("refuses the count as too big and admits the count at the ceiling", () => {
        const parametersOfSize = (size: number) =>
          Object.fromEntries(
            Array.from({ length: size }, (_, index) => [`p${index}`, index]),
          );

        const tooMany = workbenchChartDefinitionSchema.safeParse({
          version: WORKBENCH_CHART_DEFINITION_VERSION,
          sql: SQL,
          parameters: parametersOfSize(65),
        });

        expect(tooMany.success).toBe(false);
        expect(tooMany.error?.issues).toContainEqual(
          expect.objectContaining({ code: "too_big", maximum: 64 }),
        );
        expect(
          workbenchChartDefinitionSchema.safeParse({
            version: WORKBENCH_CHART_DEFINITION_VERSION,
            sql: SQL,
            parameters: parametersOfSize(64),
          }).success,
        ).toBe(true);
      });
    });

    describe("when one parameter's name is longer than the ceiling", () => {
      /** @scenario "A definition larger than the stored ceilings is refused" */
      it("refuses the name as too big and names which parameter it was", () => {
        const longName = "p".repeat(257);
        const overLongName = workbenchChartDefinitionSchema.safeParse({
          version: WORKBENCH_CHART_DEFINITION_VERSION,
          sql: SQL,
          parameters: { [longName]: "ok" },
        });

        expect(overLongName.success).toBe(false);
        expect(overLongName.error?.issues).toContainEqual(
          expect.objectContaining({
            code: "too_big",
            maximum: 256,
            path: ["parameters", longName],
          }),
        );

        // A name exactly at the ceiling is admitted.
        expect(
          workbenchChartDefinitionSchema.safeParse({
            version: WORKBENCH_CHART_DEFINITION_VERSION,
            sql: SQL,
            parameters: { ["p".repeat(256)]: "ok" },
          }).success,
        ).toBe(true);
      });
    });

    describe("when a parameter's numeric value is not a finite number", () => {
      it("refuses NaN and infinities, which JSON cannot store as numbers", () => {
        for (const value of [Number.NaN, Infinity, -Infinity]) {
          expect(
            workbenchChartDefinitionSchema.safeParse({
              version: WORKBENCH_CHART_DEFINITION_VERSION,
              sql: SQL,
              parameters: { since: value },
            }).success,
          ).toBe(false);
        }
      });
    });

    describe("when one parameter's value is longer than the ceiling", () => {
      /** @scenario "A definition larger than the stored ceilings is refused" */
      it("refuses the value as too big and names which parameter it was", () => {
        const oversized = workbenchChartDefinitionSchema.safeParse({
          version: WORKBENCH_CHART_DEFINITION_VERSION,
          sql: SQL,
          parameters: { since: "x".repeat(4_001) },
        });

        expect(oversized.success).toBe(false);
        expect(oversized.error?.issues).toContainEqual(
          expect.objectContaining({
            code: "too_big",
            maximum: 4_000,
            path: ["parameters", "since"],
          }),
        );
      });
    });
  });
});
