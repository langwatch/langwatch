import { builtinRolePermissions } from "@langwatch/authz";
import { describe, expect, it } from "vitest";
import { isOrgExclusivePermission } from "~/server/api/rbac";
import type { Permission } from "~/server/api/rbac";
import { defaultCliKeyPermissions } from "~/server/api-key/cli-key-defaults";
import { defaultCliKeyScopes } from "../cliKeyScopeDefaults";

describe("defaultCliKeyScopes()", () => {
  const organizationId = "org-1";
  const sharedTeamIds = ["team-1", "team-2"];
  const personalProject = { id: "proj-personal", teamId: "team-personal" };
  const personalTeamBinding = {
    scopeType: "TEAM",
    scopeId: "team-personal",
    role: "ADMIN",
  };

  describe("when the caller holds an ORGANIZATION-scoped ADMIN binding", () => {
    it("collapses to a single organization scope", () => {
      const scopes = defaultCliKeyScopes({
        organizationId,
        bindings: [
          { scopeType: "ORGANIZATION", scopeId: organizationId, role: "ADMIN" },
          { scopeType: "TEAM", scopeId: "team-1", role: "MEMBER" },
        ],
        sharedTeamIds,
        personalProject,
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
        personalProject: null,
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
          personalTeamBinding,
        ],
        sharedTeamIds,
        personalProject,
      });
      expect(scopes).toEqual([
        { scopeType: "TEAM", scopeId: "team-2" },
        { scopeType: "PROJECT", scopeId: "proj-personal" },
      ]);
    });

    it("offers the personal project when its team binding is held", () => {
      const scopes = defaultCliKeyScopes({
        organizationId,
        bindings: [
          {
            scopeType: "ORGANIZATION",
            scopeId: organizationId,
            role: "MEMBER",
          },
          personalTeamBinding,
        ],
        sharedTeamIds,
        personalProject,
      });
      expect(scopes).toEqual([
        { scopeType: "PROJECT", scopeId: "proj-personal" },
      ]);
    });

    it("skips a personal project whose team binding is missing and offers the organization instead", () => {
      // The personal-workspace owner grant is appended to the grants ledger
      // asynchronously and is skipped outright on a ledger outage, so the
      // personal project can be visible while its TEAM binding row is not.
      // A PROJECT chip whose ceiling resolves to the org-member bag can
      // never mint (both permissions are org-exclusive and the mint strips
      // them from selections with no ORGANIZATION binding) — the org chip
      // mints a view-only key instead of dead-ending the login.
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
        personalProject,
      });
      expect(scopes).toEqual([
        { scopeType: "ORGANIZATION", scopeId: organizationId },
      ]);
    });

    it("offers the organization when there is nothing else to offer", () => {
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
        personalProject: null,
      });
      expect(scopes).toEqual([
        { scopeType: "ORGANIZATION", scopeId: organizationId },
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
        personalProject: null,
      });
      expect(scopes).toEqual([{ scopeType: "TEAM", scopeId: "team-1" }]);
    });

    it("offers the organization when there is nothing else to offer", () => {
      const scopes = defaultCliKeyScopes({
        organizationId,
        bindings: [
          {
            scopeType: "ORGANIZATION",
            scopeId: organizationId,
            role: "VIEWER",
          },
        ],
        sharedTeamIds,
        personalProject: null,
      });
      expect(scopes).toEqual([
        { scopeType: "ORGANIZATION", scopeId: organizationId },
      ]);
    });
  });

  describe("when the caller holds only TEAM bindings", () => {
    it("offers the bound shared teams plus the personal project", () => {
      const scopes = defaultCliKeyScopes({
        organizationId,
        bindings: [
          { scopeType: "TEAM", scopeId: "team-1", role: "MEMBER" },
          { scopeType: "TEAM", scopeId: "team-other-org", role: "MEMBER" },
          personalTeamBinding,
        ],
        sharedTeamIds,
        personalProject,
      });
      expect(scopes).toEqual([
        { scopeType: "TEAM", scopeId: "team-1" },
        { scopeType: "PROJECT", scopeId: "proj-personal" },
      ]);
    });
  });

  describe("mintability of the organization-chip fallback", () => {
    // The cross-layer pin for the fallback: the screen's permission list is
    // `defaultCliKeyPermissions()` intersected with the chip's ceiling, and
    // the mint (`filterToGrantable`) keeps org-exclusive permissions only
    // when an ORGANIZATION binding is selected. If either fact drifts, the
    // fallback chip renders an approve button that can never be enabled, or
    // the approval 422s server-side — both are the dead end this exists to
    // prevent.
    it("keeps the org-member bag inside the CLI defaults, so the chip's approval carries permissions", () => {
      const defaults = new Set<string>(defaultCliKeyPermissions());
      const bag = [...builtinRolePermissions("org-member")];
      expect(bag.length).toBeGreaterThan(0);
      expect(bag.filter((p) => defaults.has(p))).toEqual(bag);
    });

    it("holds a bag that is entirely org-exclusive, so a TEAM or PROJECT chip could never mint it", () => {
      // This is why the fallback offers the ORGANIZATION chip and why a
      // personal project without its TEAM binding row is skipped: the mint
      // strips org-exclusive permissions from selections with no
      // ORGANIZATION binding, and this bag has nothing else to give.
      const bag = [...builtinRolePermissions("org-member")];
      expect(
        bag.filter((p) => isOrgExclusivePermission(p as Permission)),
      ).toEqual(bag);
    });
  });

  describe("when the caller holds no bindings at all", () => {
    it("offers nothing: there is no ceiling to mint from", () => {
      // With no RoleBinding rows the client ceiling is empty for every
      // possible chip, so any offered scope would render an approve button
      // that can never be enabled. The screen's "nothing here for you"
      // state is the honest rendering of that.
      const scopes = defaultCliKeyScopes({
        organizationId,
        bindings: [],
        sharedTeamIds,
        personalProject,
      });
      expect(scopes).toEqual([]);
    });
  });
});
