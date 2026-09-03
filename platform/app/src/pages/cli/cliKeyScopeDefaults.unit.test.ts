import { describe, expect, it } from "vitest";
import { defaultCliKeyScopes } from "./cliKeyScopeDefaults";

describe("defaultCliKeyScopes()", () => {
  const organizationId = "org-1";
  const sharedTeamIds = ["team-1", "team-2"];

  describe("when the caller holds an ORGANIZATION-scoped ADMIN binding", () => {
    it("collapses to a single organization scope", () => {
      const scopes = defaultCliKeyScopes({
        organizationId,
        bindings: [
          { scopeType: "ORGANIZATION", scopeId: organizationId, role: "ADMIN" },
          { scopeType: "TEAM", scopeId: "team-1", role: "MEMBER" },
        ],
        sharedTeamIds,
        personalProjectId: "proj-personal",
      });
      expect(scopes).toEqual([
        { scopeType: "ORGANIZATION", scopeId: organizationId },
      ]);
    });
  });

  describe("when the caller holds an ORGANIZATION-scoped CUSTOM binding", () => {
    it("collapses to a single organization scope", () => {
      const scopes = defaultCliKeyScopes({
        organizationId,
        bindings: [
          {
            scopeType: "ORGANIZATION",
            scopeId: organizationId,
            role: "CUSTOM",
          },
        ],
        sharedTeamIds,
        personalProjectId: null,
      });
      expect(scopes).toEqual([
        { scopeType: "ORGANIZATION", scopeId: organizationId },
      ]);
    });
  });

  describe("when the caller holds an ORGANIZATION-scoped MEMBER binding", () => {
    it("falls back to team scopes instead of the organization", () => {
      // An org MEMBER binding grants the org-member bag only
      // (organization:view, aiTools:view) — an org-scoped key selection
      // built from it can never carry traces or any other everyday
      // permission, so approve would refuse it wholesale.
      const scopes = defaultCliKeyScopes({
        organizationId,
        bindings: [
          {
            scopeType: "ORGANIZATION",
            scopeId: organizationId,
            role: "MEMBER",
          },
          { scopeType: "TEAM", scopeId: "team-2", role: "MEMBER" },
        ],
        sharedTeamIds,
        personalProjectId: "proj-personal",
      });
      expect(scopes).toEqual([
        { scopeType: "TEAM", scopeId: "team-2" },
        { scopeType: "PROJECT", scopeId: "proj-personal" },
      ]);
    });

    it("offers the personal project when no team bindings exist", () => {
      const scopes = defaultCliKeyScopes({
        organizationId,
        bindings: [
          {
            scopeType: "ORGANIZATION",
            scopeId: organizationId,
            role: "MEMBER",
          },
        ],
        sharedTeamIds,
        personalProjectId: "proj-personal",
      });
      expect(scopes).toEqual([
        { scopeType: "PROJECT", scopeId: "proj-personal" },
      ]);
    });
  });

  describe("when the caller holds an ORGANIZATION-scoped VIEWER binding", () => {
    it("falls back to team scopes instead of the organization", () => {
      const scopes = defaultCliKeyScopes({
        organizationId,
        bindings: [
          {
            scopeType: "ORGANIZATION",
            scopeId: organizationId,
            role: "VIEWER",
          },
          { scopeType: "TEAM", scopeId: "team-1", role: "VIEWER" },
        ],
        sharedTeamIds,
        personalProjectId: null,
      });
      expect(scopes).toEqual([{ scopeType: "TEAM", scopeId: "team-1" }]);
    });
  });

  describe("when the caller holds only TEAM bindings", () => {
    it("offers the bound shared teams plus the personal project", () => {
      const scopes = defaultCliKeyScopes({
        organizationId,
        bindings: [
          { scopeType: "TEAM", scopeId: "team-1", role: "MEMBER" },
          { scopeType: "TEAM", scopeId: "team-other-org", role: "MEMBER" },
        ],
        sharedTeamIds,
        personalProjectId: "proj-personal",
      });
      expect(scopes).toEqual([
        { scopeType: "TEAM", scopeId: "team-1" },
        { scopeType: "PROJECT", scopeId: "proj-personal" },
      ]);
    });
  });

  describe("when the caller holds no bindings", () => {
    it("offers only the personal project", () => {
      const scopes = defaultCliKeyScopes({
        organizationId,
        bindings: [],
        sharedTeamIds,
        personalProjectId: "proj-personal",
      });
      expect(scopes).toEqual([
        { scopeType: "PROJECT", scopeId: "proj-personal" },
      ]);
    });
  });
});
