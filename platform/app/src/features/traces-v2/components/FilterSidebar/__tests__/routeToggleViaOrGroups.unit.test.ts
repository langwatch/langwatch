import { describe, expect, it } from "vitest";
import { parse } from "~/server/app-layer/traces/query-language/parse";
import { analyzeOrGroups } from "~/server/app-layer/traces/query-language/queries";
import { routeToggleViaOrGroups } from "../routeToggleViaOrGroups";

describe("routeToggleViaOrGroups", () => {
  describe("given a field that is not in any OR group", () => {
    describe("when called", () => {
      it("returns AND combinator with no orGroupLocation", () => {
        const analysis = analyzeOrGroups(parse("status:error"));
        const routing = routeToggleViaOrGroups({
          analysis,
          field: "model",
        });
        expect(routing).toEqual({ combinator: "AND" });
      });
    });
  });

  describe("given a field that is in exactly one OR group", () => {
    describe("when called", () => {
      it("returns AND combinator with the group's location for splice", () => {
        // `status` is in the OR group spanning the whole query — a click
        // adding a third value extends the same-field OR rather than
        // AND-appending.
        const query = "status:error OR status:warning";
        const analysis = analyzeOrGroups(parse(query));
        const group = analysis.groups[0]!;
        const routing = routeToggleViaOrGroups({
          analysis,
          field: "status",
        });
        expect(routing).toEqual({
          combinator: "AND",
          orGroupLocation: { start: group.start, end: group.end },
        });
      });
    });
  });

  describe("given a field that is in multiple disjoint OR groups", () => {
    describe("when called", () => {
      it("targets the first group — left-most OR in the AST wins", () => {
        // `status` appears in two OR groups. The helper picks the
        // first one (`fieldToGroupIds.get(field)?.[0]`) — which is
        // the one that appears earlier in the AST walk.
        const query =
          "(status:error OR status:warning) AND (status:info OR origin:application)";
        const analysis = analyzeOrGroups(parse(query));
        const groupIds = analysis.fieldToGroupIds.get("status");
        expect(groupIds).toBeDefined();
        expect(groupIds!.length).toBe(2);
        const firstGroupId = groupIds![0]!;
        const firstGroup = analysis.groups.find((g) => g.id === firstGroupId)!;

        const routing = routeToggleViaOrGroups({
          analysis,
          field: "status",
        });
        expect(routing).toEqual({
          combinator: "AND",
          orGroupLocation: {
            start: firstGroup.start,
            end: firstGroup.end,
          },
        });
      });
    });
  });

  describe("given an empty query", () => {
    describe("when called", () => {
      it("returns AND combinator with no orGroupLocation", () => {
        const analysis = analyzeOrGroups(parse(""));
        const routing = routeToggleViaOrGroups({
          analysis,
          field: "status",
        });
        expect(routing).toEqual({ combinator: "AND" });
      });
    });
  });
});
