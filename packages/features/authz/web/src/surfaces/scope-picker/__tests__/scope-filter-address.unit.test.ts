/**
 * The `?scope=` address contract, as two settings families now share it.
 *
 * These cases were `platform/app`'s, on the hook that owned the URL before the
 * data-governance families moved; they are about the contract rather than about
 * the router, so they travel with the pure half.
 */

import { describe, expect, it } from "vitest";
import {
  isScopeInFilter,
  resolveScopeFilter,
  scopeFilterAddressWrite,
  scopeFilterFromAddress,
  scopeHierarchyOf,
} from "../scope-filter-address";
import type { AvailableScopes } from "../scope-filter";

const available: AvailableScopes = {
  organization: { id: "org_1", name: "Acme" },
  teams: [{ id: "team_1", name: "Platform" }],
  projects: [{ id: "project_1", name: "Checkout", teamId: "team_1" }],
};

describe("given a scope written into the address", () => {
  describe("when the address names a scope the reader can see", () => {
    it("reads it back with the name from the org graph", () => {
      expect(scopeFilterFromAddress({ raw: "TEAM:team_1", available })).toEqual({
        kind: "specific",
        scopeType: "TEAM",
        scopeId: "team_1",
        name: "Platform",
      });
    });
  });

  describe("when the address names a scope that no longer exists", () => {
    it("falls back to everything the reader can see", () => {
      expect(scopeFilterFromAddress({ raw: "TEAM:deleted", available })).toEqual({
        kind: "all",
      });
    });
  });

  describe("when the address is absent or malformed", () => {
    it("reads as everything the reader can see", () => {
      expect(scopeFilterFromAddress({ raw: void 0, available })).toEqual({ kind: "all" });
      expect(scopeFilterFromAddress({ raw: ":team_1", available })).toEqual({ kind: "all" });
      expect(scopeFilterFromAddress({ raw: "TEAM:", available })).toEqual({ kind: "all" });
      expect(scopeFilterFromAddress({ raw: "DEPARTMENT:d1", available })).toEqual({
        kind: "all",
      });
    });
  });
});

describe("given a filter being written to the address", () => {
  describe("when the reader picks everything they can see", () => {
    it("clears the parameter rather than writing a value", () => {
      expect(scopeFilterAddressWrite({ kind: "all" }, { teamId: "team_1" })).toEqual({
        kind: "clear",
      });
    });
  });

  describe("when the reader picks their current team", () => {
    it("writes the ambient team id", () => {
      expect(scopeFilterAddressWrite({ kind: "team-current" }, { teamId: "team_1" })).toEqual({
        kind: "set",
        value: "TEAM:team_1",
      });
    });

    it("leaves the address alone when there is no ambient team", () => {
      expect(scopeFilterAddressWrite({ kind: "team-current" }, {})).toEqual({
        kind: "keep",
      });
    });
  });

  describe("when the reader picks a specific scope", () => {
    it("writes its type and id", () => {
      expect(
        scopeFilterAddressWrite(
          { kind: "specific", scopeType: "PROJECT", scopeId: "project_1", name: "Checkout" },
          {},
        ),
      ).toEqual({ kind: "set", value: "PROJECT:project_1" });
    });
  });
});

describe("given rows scoped across an organization", () => {
  const hierarchy = scopeHierarchyOf(available);

  describe("when the filter is a team", () => {
    const filter = resolveScopeFilter({ kind: "team-current" }, { currentTeamId: "team_1" });

    it("keeps the organization above it and the projects below it", () => {
      expect(
        isScopeInFilter({ scopeType: "ORGANIZATION", scopeId: "org_1" }, filter, hierarchy),
      ).toBe(true);
      expect(
        isScopeInFilter({ scopeType: "PROJECT", scopeId: "project_1" }, filter, hierarchy),
      ).toBe(true);
    });

    it("drops a sibling team and its projects", () => {
      expect(isScopeInFilter({ scopeType: "TEAM", scopeId: "team_2" }, filter, hierarchy)).toBe(
        false,
      );
      expect(
        isScopeInFilter({ scopeType: "PROJECT", scopeId: "project_9" }, filter, hierarchy),
      ).toBe(false);
    });
  });

  describe("when the ambient scope the filter names is missing", () => {
    it("resolves to everything rather than to nothing", () => {
      expect(resolveScopeFilter({ kind: "project-current" }, {})).toEqual({ kind: "all" });
    });
  });
});
