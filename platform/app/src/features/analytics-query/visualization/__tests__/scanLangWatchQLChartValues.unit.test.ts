/**
 * What the rows look like to a chart, before the chart sees them.
 *
 * The distinction under test is the one the specification insists on: zero,
 * null and missing are values a chart can draw honestly and are left alone,
 * while a value the scales cannot carry is reported rather than quietly turned
 * into a position on an axis.
 *
 * Node environment on purpose — see `validateVegaLiteSpec.unit.test.ts`.
 */
import { describe, expect, it } from "vitest";

import {
  encodedFieldsByDataset,
  scanLangWatchQLChartValues,
} from "../scanLangWatchQLChartValues";
import type { LangWatchQLDatasetColumn } from "../visualization.types";

const COLUMNS: readonly LangWatchQLDatasetColumn[] = [
  { name: "model", type: "String" },
  { name: "total", type: "UInt64" },
  { name: "latency", type: "Float64" },
];

const scan = (rows: readonly Record<string, unknown>[], fields: string[]) =>
  scanLangWatchQLChartValues({
    encodedFieldsByDataset: { query_result: fields },
    datasets: { query_result: rows },
    columnsByDataset: { query_result: COLUMNS },
  });

describe("scanning the values a chart will encode", () => {
  describe("given rows holding zero, null, missing, NaN and infinity", () => {
    /** @scenario "Values Vega cannot represent faithfully produce a warning, not a zero" */
    it("leaves zero, null and missing alone and warns about the rest", () => {
      const result = scan(
        [
          { model: "a", latency: 0 },
          { model: "b", latency: null },
          { model: "c" },
          { model: "d", latency: Number.NaN },
          { model: "e", latency: Number.POSITIVE_INFINITY },
        ],
        ["model", "latency"],
      );

      expect(result.allEncodedValuesEmpty).toBe(false);
      expect(result.warnings).toHaveLength(1);

      const [warning] = result.warnings;
      expect(warning?.code).toBe("unrepresentable-value");
      expect(warning?.meta?.kind).toBe("non-finite");
      expect(warning?.meta?.count).toBe(2);
      expect(warning?.message).toContain("latency");
      // A non-finite value is reported as such, never substituted with 0.
      expect(warning?.message).not.toContain("0");
    });

    it("says nothing when every value is one a chart can place", () => {
      const result = scan(
        [
          { model: "a", latency: 0, total: 1 },
          { model: "b", latency: -2.5, total: 0 },
        ],
        ["model", "latency", "total"],
      );

      expect(result.warnings).toEqual([]);
      expect(result.allEncodedValuesEmpty).toBe(false);
    });
  });

  describe("given a wide integer column", () => {
    /** @scenario "Values Vega cannot represent faithfully produce a warning, not a zero" */
    it("warns when a value has more digits than a chart can plot exactly", () => {
      const result = scan(
        [
          { model: "a", total: "9007199254740993" },
          { model: "b", total: "12" },
        ],
        ["total"],
      );

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]?.meta).toMatchObject({
        kind: "precision",
        count: 1,
        field: "total",
      });
    });

    it("warns about a big integer the same way, whatever carried it", () => {
      const result = scan([{ total: 9007199254740993n }], ["total"]);

      expect(result.warnings[0]?.meta).toMatchObject({
        kind: "precision",
        count: 1,
      });
    });

    it("says nothing about a value that survives the round trip", () => {
      const result = scan([{ total: "42" }, { total: "-7" }], ["total"]);

      expect(result.warnings).toEqual([]);
    });
  });

  describe("given encoded columns with nothing in them", () => {
    /** @scenario "Chart failures are distinct intentional states, never a blank chart" */
    it("reports that there is nothing to draw", () => {
      expect(
        scan([{ model: null }, { model: "" }, {}], ["model"])
          .allEncodedValuesEmpty,
      ).toBe(true);
      expect(scan([], ["model"]).allEncodedValuesEmpty).toBe(true);
    });

    it("does not report it when one encoded column has values", () => {
      expect(
        scan([{ model: null, latency: 3 }], ["model", "latency"])
          .allEncodedValuesEmpty,
      ).toBe(false);
    });

    it("does not report it when the specification encodes nothing at all", () => {
      expect(scan([{ model: "a" }], []).allEncodedValuesEmpty).toBe(false);
    });
  });
});

describe("reading which columns a specification encodes", () => {
  describe("given a specification over a registered dataset", () => {
    it("names the columns it references and nothing else", () => {
      expect(
        encodedFieldsByDataset({
          spec: {
            data: { name: "query_result" },
            mark: "bar",
            encoding: {
              x: { field: "model", type: "nominal" },
              y: { field: "total", type: "quantitative" },
            },
          },
          datasetNames: ["query_result"],
          columnsByDataset: { query_result: COLUMNS },
        }),
      ).toEqual({ query_result: ["model", "total"] });
    });

    it("ignores a name that is not a column of the dataset", () => {
      expect(
        encodedFieldsByDataset({
          spec: {
            data: { name: "query_result" },
            transform: [{ calculate: "datum.total * 2", as: "doubled" }],
            mark: "bar",
            encoding: { y: { field: "doubled", type: "quantitative" } },
          },
          datasetNames: ["query_result"],
          columnsByDataset: { query_result: COLUMNS },
        }),
      ).toEqual({ query_result: [] });
    });
  });

  describe("given a column whose name contains a literal dot", () => {
    const DOTTED: readonly LangWatchQLDatasetColumn[] = [
      { name: "model", type: "String" },
      { name: "usage.total_tokens", type: "UInt64" },
    ];

    /**
     * Vega-Lite writes such a column as `usage\.total_tokens`, while the
     * response carries the unescaped name. Matching only the raw spelling
     * dropped the column from the scan set, and a dropped column is silently
     * never checked for non-finite or wide-integer values.
     */
    it("recognises the escaped spelling as that column", () => {
      expect(
        encodedFieldsByDataset({
          spec: {
            data: { name: "query_result" },
            mark: "bar",
            encoding: {
              x: { field: "model", type: "nominal" },
              y: { field: "usage\\.total_tokens", type: "quantitative" },
            },
          },
          datasetNames: ["query_result"],
          columnsByDataset: { query_result: DOTTED },
        }),
      ).toEqual({ query_result: ["model", "usage.total_tokens"] });
    });
  });
});
