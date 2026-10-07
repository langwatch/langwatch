/**
 * How the All dashboards page narrows and orders its list.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import { describe, expect, it } from "vitest";

import { filterDashboards, sortDashboards } from "../model/all-dashboards.ts";

const BOARDS = [
  {
    id: "a",
    name: "Weekly review",
    description: "Cost and latency",
    updatedAt: new Date("2026-01-02"),
  },
  { id: "b", name: "Latency", description: null, updatedAt: new Date("2026-01-03") },
  { id: "c", name: "Agents", description: "Weekly latency", updatedAt: new Date("2026-01-01") },
];

const idsOf = (boards: readonly { id: string }[]) => boards.map(({ id }) => id);

describe("the All dashboards list", () => {
  /** @scenario "AC151b Search narrows the list and sort orders it" */
  it("keeps only boards whose name or description holds every word", () => {
    expect(idsOf(filterDashboards({ boards: BOARDS, search: "weekly latency" }))).toEqual([
      "a",
      "c",
    ]);
    expect(idsOf(filterDashboards({ boards: BOARDS, search: "LATENCY" }))).toEqual(["a", "b", "c"]);
    expect(idsOf(filterDashboards({ boards: BOARDS, search: "nothing" }))).toEqual([]);
  });

  /** @scenario "AC151b Search narrows the list and sort orders it" */
  it("keeps every board for a blank search", () => {
    expect(idsOf(filterDashboards({ boards: BOARDS, search: "   " }))).toEqual(["a", "b", "c"]);
  });

  /** @scenario "AC151b Search narrows the list and sort orders it" */
  it("sorts by last change, newest first, or by name, A to Z", () => {
    expect(idsOf(sortDashboards({ boards: BOARDS, sort: "recently-updated" }))).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(idsOf(sortDashboards({ boards: BOARDS, sort: "name" }))).toEqual(["c", "b", "a"]);
  });
});
