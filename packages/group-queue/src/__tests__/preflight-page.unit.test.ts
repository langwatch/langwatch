import { describe, expect, it } from "vitest";

import {
  addPreflightPage,
  PREFLIGHT_NAMED_GROUP_LIMIT,
  type PreflightTargetsState,
} from "../scripts.ts";

const NOTHING: PreflightTargetsState = {
  pending: 0,
  active: 0,
  failed: 0,
  blocked: 0,
  groups: 0,
  heldFromBefore: 0,
  pendingGroups: 0,
  failedGroupIds: [],
  blockedGroupIds: [],
  pendingGroupIds: [],
  heldFromBeforeGroupIds: [],
  changedDuringInspection: false,
};

function idsFrom({ prefix, count }: { prefix: string; count: number }): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}-${index}`);
}

describe("addPreflightPage", () => {
  describe("given the replies of several slices of the barrier's look", () => {
    /** @scenario "Slices of a look add up to one look" */
    it("sums every count across the slices", () => {
      const first = [3, 1, 0, 1, 500, 2, 4, [], ["b-0"], ["p-0"], ["h-0"]];
      const second = [5, 0, 1, 0, 500, 0, 5, ["f-1"], [], ["p-1"], []];

      const state = addPreflightPage({
        state: addPreflightPage({ state: NOTHING, reply: first }),
        reply: second,
      });

      expect(state).toEqual({
        pending: 8,
        active: 1,
        failed: 1,
        blocked: 1,
        groups: 1000,
        heldFromBefore: 2,
        pendingGroups: 9,
        failedGroupIds: ["f-1"],
        blockedGroupIds: ["b-0"],
        pendingGroupIds: ["p-0", "p-1"],
        heldFromBeforeGroupIds: ["h-0"],
        changedDuringInspection: false,
      });
    });

    /** @scenario "Slices of a look add up to one look" */
    it("stops each list of named groups at the refusal's naming limit", () => {
      const slice = (prefix: string) => [
        0,
        0,
        0,
        0,
        500,
        0,
        15,
        [],
        [],
        idsFrom({ prefix, count: 15 }),
        [],
      ];

      const state = addPreflightPage({
        state: addPreflightPage({ state: NOTHING, reply: slice("a") }),
        reply: slice("b"),
      });

      expect(state.pendingGroups).toBe(30);
      expect(state.pendingGroupIds).toHaveLength(PREFLIGHT_NAMED_GROUP_LIMIT);
      expect(state.pendingGroupIds.slice(0, 15)).toEqual(idsFrom({ prefix: "a", count: 15 }));
    });
  });
});
