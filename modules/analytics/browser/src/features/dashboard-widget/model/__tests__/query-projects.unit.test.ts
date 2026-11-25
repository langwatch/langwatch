/**
 * @see modules/dashboard/specs/dashboards-v2.feature AC207, AC208b
 */
import { describe, expect, it } from "vitest";

import { queryProjectsView, withoutProjectAt } from "../query-projects.ts";

const READABLE = [
  { id: "A", name: "Alpha" },
  { id: "B", name: "Beta" },
];

describe("given a member who reads A and B and not C", () => {
  /** @scenario "AC207 Project: the editor offers only the projects the member can read" */
  it("offers A and B, never C, and no project twice", () => {
    expect(queryProjectsView({ picked: null, readable: READABLE }).offered).toEqual(READABLE);
    expect(queryProjectsView({ picked: ["B"], readable: READABLE }).offered).toEqual([READABLE[0]]);
  });

  /** @scenario "AC207 Project: the editor offers only the projects the member can read" */
  it("reads the board's project while the query stores none", () => {
    expect(queryProjectsView({ picked: null, readable: READABLE }).followsBoard).toBe(true);
    expect(queryProjectsView({ picked: ["A"], readable: READABLE }).followsBoard).toBe(false);
  });

  /** @scenario "AC208b Project: an editor sees the hidden project as a count and removes it by position" */
  it("counts a named project they cannot read, without its id or name", () => {
    const view = queryProjectsView({ picked: ["A", "C"], readable: READABLE });

    expect(view.entries).toEqual([{ index: 0, id: "A", name: "Alpha" }]);
    expect(view.hiddenAt).toHaveLength(1);
    expect(view.hiddenAt).toEqual([1]);
    expect(JSON.stringify(view)).not.toContain('"C"');
  });

  /** @scenario "AC208b Project: an editor sees the hidden project as a count and removes it by position" */
  it("drops an entry by its position, and stores none once the list is empty", () => {
    expect(withoutProjectAt({ picked: ["A", "C", "B"], index: 1 })).toEqual(["A", "B"]);
    expect(withoutProjectAt({ picked: ["C"], index: 0 })).toBeNull();
  });

  /** @scenario "AC207c Project: a query stores at most as many projects as a member's list may hold" */
  it("offers no further project once the maximum is picked", () => {
    const picked = Array.from({ length: 100 }, (_, index) => `p${index}`);

    expect(queryProjectsView({ picked, readable: READABLE }).offered).toEqual([]);
  });
});
