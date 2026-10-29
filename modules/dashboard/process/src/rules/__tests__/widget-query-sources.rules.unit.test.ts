/**
 * A widget query's sources on write: a new widget's default, and an update keeping stored lists.
 * @see modules/dashboard/specs/dashboards-v2.feature AC200j, AC200o
 */
import { describe, expect, it } from "vitest";

import { mergeQuerySources, withNewQuerySources } from "../widget-query-sources.rules.ts";

const QUERY = { name: "main", sql: "SELECT 1" };

describe("withNewQuerySources", () => {
  /** @scenario "AC200o Sources: a new widget's query counts application traces" */
  it("stores application on an unset query and keeps a list that is given", () => {
    expect(
      withNewQuerySources([
        QUERY,
        { ...QUERY, name: "turns", sources: [] },
        { ...QUERY, sources: null },
      ]),
    ).toEqual([
      { ...QUERY, sources: ["application"] },
      { ...QUERY, name: "turns", sources: [] },
      { ...QUERY, sources: ["application"] },
    ]);
  });
});

describe("mergeQuerySources", () => {
  const stored = [
    { ...QUERY, sources: ["langy" as const] },
    { ...QUERY, name: "unset" },
  ];

  /** @scenario "AC200j Sources: the API and the CLI read and write a query's sources" */
  it("keeps the list stored under a query's name when it is sent without one", () => {
    expect(mergeQuerySources({ sent: [{ ...QUERY, sql: "SELECT 2" }], stored })).toEqual([
      { ...QUERY, sql: "SELECT 2", sources: ["langy"] },
    ]);
  });

  /** @scenario "AC200j Sources: the API and the CLI read and write a query's sources" */
  it("makes a query unset with null, and stores a list or an empty list as sent", () => {
    expect(mergeQuerySources({ sent: [{ ...QUERY, sources: null }], stored })).toEqual([QUERY]);
    expect(mergeQuerySources({ sent: [{ ...QUERY, sources: [] }], stored })).toEqual([
      { ...QUERY, sources: [] },
    ]);
  });

  /** @scenario "AC200f Sources: a query that stores none counts application traces" */
  it("leaves an unset query unset, and a new name with nothing stored unset", () => {
    expect(
      mergeQuerySources({
        sent: [
          { ...QUERY, name: "unset" },
          { ...QUERY, name: "new" },
        ],
        stored,
      }),
    ).toEqual([
      { ...QUERY, name: "unset" },
      { ...QUERY, name: "new" },
    ]);
  });
});
