import { describe, expect, it } from "vitest";

import { resolveScopeChain } from "./resolveScopeChain";
import { SCOPE_TIERS, scopeAssignmentSchema } from "./scope.types";

describe("scope contract", () => {
  describe("SCOPE_TIERS", () => {
    it("carries the three universal tiers in cascade-agnostic order", () => {
      expect(SCOPE_TIERS).toEqual(["ORGANIZATION", "TEAM", "PROJECT"]);
    });

    it("excludes the budget-only VIRTUAL_KEY and PRINCIPAL tiers", () => {
      expect(SCOPE_TIERS).not.toContain("VIRTUAL_KEY");
      expect(SCOPE_TIERS).not.toContain("PRINCIPAL");
    });
  });

  describe("scopeAssignmentSchema", () => {
    describe("when given a well-formed camelCase assignment", () => {
      it("accepts it unchanged", () => {
        const parsed = scopeAssignmentSchema.parse({
          scopeType: "PROJECT",
          scopeId: "project_01",
        });
        expect(parsed).toEqual({ scopeType: "PROJECT", scopeId: "project_01" });
      });
    });

    describe("when scopeId is empty", () => {
      it("rejects it", () => {
        expect(
          scopeAssignmentSchema.safeParse({ scopeType: "TEAM", scopeId: "" })
            .success,
        ).toBe(false);
      });
    });

    describe("when scopeType is outside the universal tiers", () => {
      it("rejects a budget-only tier", () => {
        expect(
          scopeAssignmentSchema.safeParse({
            scopeType: "VIRTUAL_KEY",
            scopeId: "vk_01",
          }).success,
        ).toBe(false);
      });
    });

    describe("when given snake_case keys", () => {
      it("rejects them so the wire format stays camelCase", () => {
        expect(
          scopeAssignmentSchema.safeParse({
            scope_type: "PROJECT",
            scope_id: "project_01",
          }).success,
        ).toBe(false);
      });
    });
  });

  describe("resolveScopeChain", () => {
    const ctx = {
      organizationId: "org_01",
      teamId: "team_01",
      projectId: "project_01",
    };

    it("orders the chain most-specific-first (PROJECT, TEAM, ORGANIZATION)", () => {
      expect(resolveScopeChain(ctx).map((s) => s.scopeType)).toEqual([
        "PROJECT",
        "TEAM",
        "ORGANIZATION",
      ]);
    });

    it("maps each tier to its own id", () => {
      expect(resolveScopeChain(ctx)).toEqual([
        { scopeType: "PROJECT", scopeId: "project_01" },
        { scopeType: "TEAM", scopeId: "team_01" },
        { scopeType: "ORGANIZATION", scopeId: "org_01" },
      ]);
    });
  });
});
