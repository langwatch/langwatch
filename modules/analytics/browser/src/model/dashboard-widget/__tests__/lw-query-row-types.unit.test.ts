/**
 * @see specs/analytics-widget-editor.feature
 */

import { describe, expect, it } from "vitest";

import { lwColumnTsType, lwQueryRowTypesDts } from "../lw-query-row-types.ts";

describe("lwColumnTsType()", () => {
  /** @scenario "ClickHouse column types map to the TypeScript type a row carries" */
  it.each([
    ["UInt32", "number"],
    ["Float64", "number"],
    ["UInt64", "string | number"],
    ["Decimal(18, 4)", "string | number"],
    ["DateTime64(3)", "string"],
    ["Bool", "boolean"],
    ["Nullable(String)", "string | null"],
    ["LowCardinality(Nullable(String))", "string | null"],
    ["Array(UInt8)", "(number)[]"],
    ["Map(String, UInt64)", "Record<string, string | number>"],
    ["SimpleAggregateFunction(sum, UInt8)", "number"],
    ["Tuple(String, UInt8)", "unknown"],
  ])("maps %s to %s", (clickhouseType, expected) => {
    expect(lwColumnTsType({ clickhouseType })).toBe(expected);
  });
});

describe("lwQueryRowTypesDts()", () => {
  it("declares nothing for a query that has not run", () => {
    expect(lwQueryRowTypesDts({ queries: [{ name: "main", columns: [] }] })).not.toContain("main");
  });

  it("quotes column names so an unusual name cannot break the declaration", () => {
    const dts = lwQueryRowTypesDts({
      queries: [{ name: "main", columns: [{ name: 'a"b c', type: "String" }] }],
    });
    expect(dts).toContain('"a\\"b c": string;');
  });
});
