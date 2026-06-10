import { describe, expect, it } from "vitest";
import { analyzeOrGroups } from "~/server/app-layer/traces/query-language/queries";
import { parse } from "~/server/app-layer/traces/query-language/parse";
import { routeToggleViaOrGroups } from "../routeToggleViaOrGroups";

describe("routeToggleViaOrGroups", () => {
  describe("given a field that is not in any OR group", () => {
    describe("when modifierKey is false", () => {
      it("returns AND combinator with no orGroupLocation", () => {
        const analysis = analyzeOrGroups(parse("status:error"));
        const routing = routeToggleViaOrGroups({
          analysis,
          field: "model",
          modifierKey: false,
        });
        expect(routing).toEqual({ combinator: "AND" });
      });
    });

    describe("when modifierKey is true", () => {
      it("returns OR combinator with no orGroupLocation", () => {
        const analysis = analyzeOrGroups(parse("status:error"));
        const routing = routeToggleViaOrGroups({
          analysis,
          field: "model",
          modifierKey: true,
        });
        expect(routing).toEqual({ combinator: "OR" });
      });
    });
  });

  describe("given a field that is in exactly one OR group", () => {
    describe("when modifierKey is false", () => {
      it("returns AND combinator with the group's location for splice", () => {
        // `status` is in the OR group spanning the whole query.
        const query = "status:error OR model:gpt-4o";
        const analysis = analyzeOrGroups(parse(query));
        const group = analysis.groups[0]!;
        const routing = routeToggleViaOrGroups({
          analysis,
          field: "status",
          modifierKey: false,
        });
        expect(routing).toEqual({
          combinator: "AND",
          orGroupLocation: { start: group.start, end: group.end },
        });
      });
    });

    describe("when modifierKey is true", () => {
      it("ignores the modifier and still routes into the existing group", () => {
        // The user's intent when clicking a value within an
        // OR-grouped facet is "extend the alternative" — the modifier
        // is irrelevant because the OR scope already exists.
        const query = "status:error OR model:gpt-4o";
        const analysis = analyzeOrGroups(parse(query));
        const group = analysis.groups[0]!;
        const routing = routeToggleViaOrGroups({
          analysis,
          field: "status",
          modifierKey: true,
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
          "(status:error OR model:gpt-4o) AND (status:warning OR origin:application)";
        const analysis = analyzeOrGroups(parse(query));
        const groupIds = analysis.fieldToGroupIds.get("status");
        expect(groupIds).toBeDefined();
        expect(groupIds!.length).toBe(2);
        const firstGroupId = groupIds![0]!;
        const firstGroup = analysis.groups.find((g) => g.id === firstGroupId)!;

        const routing = routeToggleViaOrGroups({
          analysis,
          field: "status",
          modifierKey: false,
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
    describe("when modifierKey is false", () => {
      it("returns AND combinator with no orGroupLocation", () => {
        const analysis = analyzeOrGroups(parse(""));
        const routing = routeToggleViaOrGroups({
          analysis,
          field: "status",
          modifierKey: false,
        });
        expect(routing).toEqual({ combinator: "AND" });
      });
    });

    describe("when modifierKey is true", () => {
      it("returns OR combinator with no orGroupLocation", () => {
        const analysis = analyzeOrGroups(parse(""));
        const routing = routeToggleViaOrGroups({
          analysis,
          field: "status",
          modifierKey: true,
        });
        expect(routing).toEqual({ combinator: "OR" });
      });
    });
  });
});
