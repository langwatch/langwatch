/**
 * A widget query's sources on write: a new widget's default, and an update keeping stored lists.
 * @see modules/dashboard/specs/dashboards-v2.feature AC200j, AC200o
 */
import { describe, expect, it } from "vitest";

import {
  mergeQuerySources,
  projectsNamedBy,
  withNewQuerySources,
} from "../widget-query-sources.rules.ts";

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

describe("a query's projects", () => {
  const storedWithProjects = [{ ...QUERY, projects: ["A", "B"] }];

  /** @scenario "AC210b Compatibility: the dashboard API, the CLI and the MCP tools read and write projects beside sources" */
  it("keeps the list stored under the name when sent without one, clears it with null", () => {
    expect(mergeQuerySources({ sent: [QUERY], stored: storedWithProjects })).toEqual([
      { ...QUERY, projects: ["A", "B"] },
    ]);
    expect(
      mergeQuerySources({ sent: [{ ...QUERY, projects: null }], stored: storedWithProjects }),
    ).toEqual([QUERY]);
    expect(
      mergeQuerySources({ sent: [{ ...QUERY, projects: ["C"] }], stored: storedWithProjects }),
    ).toEqual([{ ...QUERY, projects: ["C"] }]);
  });

  /** @scenario "AC210 Compatibility: a widget saved before projects existed reads the board's project" */
  it("stores no projects on a query that had none", () => {
    expect(mergeQuerySources({ sent: [QUERY], stored: [QUERY] })).toEqual([QUERY]);
    expect(withNewQuerySources([QUERY])).toEqual([{ ...QUERY, sources: ["application"] }]);
  });

  it("names each project once across the queries", () => {
    expect(
      projectsNamedBy([
        { ...QUERY, projects: ["B", "A"] },
        { ...QUERY, name: "two", projects: ["A", "C"] },
        { ...QUERY, name: "three" },
      ]),
    ).toEqual(["B", "A", "C"]);
  });
});
