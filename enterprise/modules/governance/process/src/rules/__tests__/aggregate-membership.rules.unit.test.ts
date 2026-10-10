// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { describe, expect, it } from "vitest";

import { decideAggregateMembership } from "../aggregate-membership.rules.ts";

describe("decideAggregateMembership", () => {
  describe("given members the rule wants, some held and some not", () => {
    it("attaches the missing, revokes the unwanted and leaves the rest, each sorted", () => {
      expect(
        decideAggregateMembership({
          aggregateProjectId: "agg",
          desired: ["c", "a", "b"],
          held: ["d", "b"],
        }),
      ).toEqual({ attach: ["a", "c"], revoke: ["d"], unchanged: ["b"] });
    });
  });

  describe("given a rule that selects the aggregate itself", () => {
    it("never counts the aggregate as its own member", () => {
      expect(
        decideAggregateMembership({ aggregateProjectId: "agg", desired: ["agg", "a"], held: [] }),
      ).toEqual({ attach: ["a"], revoke: [], unchanged: [] });
    });
  });

  describe("given members that are current", () => {
    it("decides nothing new", () => {
      expect(
        decideAggregateMembership({ aggregateProjectId: "agg", desired: ["a"], held: ["a"] }),
      ).toEqual({ attach: [], revoke: [], unchanged: ["a"] });
    });
  });
});
