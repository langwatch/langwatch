/**
 * What each built-in role actually grants. The bags are declared as
 * differences, so a permission moved between VIEWER, MEMBER_ADDITIONS and
 * ADMIN_ADDITIONS changes several roles at once — these are the decisions
 * that must not move with it.
 * Spec: specs/rbac/fetch-org-role-permission-resolution.feature
 */
import { describe, expect, it } from "vitest";
import { type BuiltinRoleKey, builtinRoleGrants, roleKeyForTeamRole } from "../roles.ts";

const grants = (role: BuiltinRoleKey, permission: string): boolean =>
  builtinRoleGrants({ role, permission });

describe("given the team roles", () => {
  describe("when the holder is an admin", () => {
    /** @scenario "A team admin holds the whole project lifecycle" */
    it.concurrent("holds the whole project lifecycle and team administration", () => {
      for (const action of ["view", "create", "update", "delete", "manage"]) {
        expect(grants("admin", `project:${action}`)).toBe(true);
      }
      expect(grants("admin", "team:manage")).toBe(true);
    });
  });

  describe("when the holder is a member", () => {
    /** @scenario "A team member creates and updates projects but never deletes one" */
    it.concurrent("creates and updates projects but never deletes or administers one", () => {
      expect(grants("member", "project:view")).toBe(true);
      expect(grants("member", "project:create")).toBe(true);
      expect(grants("member", "project:update")).toBe(true);
      expect(grants("member", "project:delete")).toBe(false);
      expect(grants("member", "project:manage")).toBe(false);
    });

    /** @scenario "A team member creates and updates projects but never deletes one" */
    it.concurrent("does not administer the team", () => {
      expect(grants("member", "team:manage")).toBe(false);
    });
  });

  describe("when the holder is a viewer", () => {
    /** @scenario "A team viewer reads and changes nothing" */
    it.concurrent("reads a project and changes nothing in it", () => {
      expect(grants("viewer", "project:view")).toBe(true);
      for (const action of ["create", "update", "delete", "manage"]) {
        expect(grants("viewer", `project:${action}`)).toBe(false);
      }
    });

    /** @scenario "A team viewer reads and changes nothing" */
    it.concurrent("reads workflows and datasets without managing either", () => {
      expect(grants("viewer", "workflows:view")).toBe(true);
      expect(grants("viewer", "workflows:manage")).toBe(false);
      expect(grants("viewer", "datasets:view")).toBe(true);
      expect(grants("viewer", "datasets:manage")).toBe(false);
    });

    /** @scenario "Cost visibility starts at team member" */
    it.concurrent("cannot see cost, which starts at member", () => {
      expect(grants("viewer", "cost:view")).toBe(false);
      expect(grants("member", "cost:view")).toBe(true);
      expect(grants("admin", "cost:view")).toBe(true);
    });
  });

  describe("when a request asks to manage traces", () => {
    /** @scenario "Traces carry read and share, never manage" */
    it.concurrent("refuses every role — traces carry read and share only", () => {
      for (const role of ["admin", "member", "viewer"] as const) {
        expect(grants(role, "traces:manage")).toBe(false);
      }
      expect(grants("member", "traces:share")).toBe(true);
      expect(grants("viewer", "traces:share")).toBe(false);
    });
  });

  describe("when a legacy team role is mapped onto a built-in bag", () => {
    /** @scenario "A CUSTOM team role falls back to the viewer bag" */
    it.concurrent("falls a CUSTOM role back to the viewer bag", () => {
      expect(roleKeyForTeamRole("ADMIN")).toBe("admin");
      expect(roleKeyForTeamRole("MEMBER")).toBe("member");
      expect(roleKeyForTeamRole("VIEWER")).toBe("viewer");
      expect(grants(roleKeyForTeamRole("CUSTOM"), "workflows:view")).toBe(true);
      expect(grants(roleKeyForTeamRole("CUSTOM"), "workflows:manage")).toBe(false);
    });
  });
});

describe("given the organization roles", () => {
  describe("when the holder is an organization admin", () => {
    /** @scenario "An organization admin holds the organization and its governance surfaces" */
    it.concurrent("views, manages and deletes the organization", () => {
      expect(grants("org-admin", "organization:view")).toBe(true);
      expect(grants("org-admin", "organization:manage")).toBe(true);
      expect(grants("org-admin", "organization:delete")).toBe(true);
    });

    /** @scenario "An organization admin holds the organization and its governance surfaces" */
    it.concurrent("reaches every governance surface", () => {
      for (const permission of [
        "governance:view",
        "governance:manage",
        "ingestionSources:view",
        "ingestionSources:create",
        "ingestionSources:manage",
        "anomalyRules:view",
        "anomalyRules:create",
        "anomalyRules:manage",
        "complianceExport:view",
        "activityMonitor:view",
      ]) {
        expect(grants("org-admin", permission)).toBe(true);
      }
    });

    /** @scenario "An organization admin holds the organization and its governance surfaces" */
    it.concurrent("satisfies a view-level check from the manage grant it holds", () => {
      expect(grants("org-admin", "ingestionSources:update")).toBe(true);
      expect(grants("org-admin", "anomalyRules:delete")).toBe(true);
    });
  });

  describe("when the holder is a plain organization member", () => {
    /** @scenario "Every organization member holds the member floor" */
    it.concurrent("views the organization and nothing more", () => {
      expect(grants("org-member", "organization:view")).toBe(true);
      expect(grants("org-member", "organization:manage")).toBe(false);
      expect(grants("org-member", "organization:delete")).toBe(false);
    });

    /** @scenario "A plain organization member holds no governance permission" */
    it.concurrent("holds no governance permission by default", () => {
      for (const permission of [
        "governance:view",
        "governance:manage",
        "ingestionSources:view",
        "anomalyRules:view",
        "complianceExport:view",
        "activityMonitor:view",
      ]) {
        expect(grants("org-member", permission)).toBe(false);
      }
    });
  });

  describe("when the holder is a lite member", () => {
    /** @scenario "A lite member reads the product, comments on it, and configures nothing" */
    it.concurrent("holds no governance permission", () => {
      for (const permission of [
        "governance:view",
        "ingestionSources:view",
        "anomalyRules:view",
        "complianceExport:view",
        "activityMonitor:view",
      ]) {
        expect(grants("lite-member", permission)).toBe(false);
      }
    });

    /** @scenario "A lite member reads the product, comments on it, and configures nothing" */
    it.concurrent("reads the product and comments on it", () => {
      for (const permission of [
        "project:view",
        "analytics:view",
        "traces:view",
        "annotations:view",
        "evaluations:view",
        "datasets:view",
        "workflows:view",
        "prompts:view",
        "scenarios:view",
        "secrets:view",
        "team:view",
      ]) {
        expect(grants("lite-member", permission)).toBe(true);
      }
      expect(grants("lite-member", "annotations:create")).toBe(true);
      expect(grants("lite-member", "annotations:update")).toBe(true);
    });

    /** @scenario "A lite member reads the product, comments on it, and configures nothing" */
    it.concurrent("configures nothing, in the product or the gateway", () => {
      for (const permission of [
        "datasets:manage",
        "prompts:manage",
        "annotations:manage",
        "evaluations:manage",
        "workflows:manage",
        "scenarios:manage",
        "secrets:manage",
        "team:manage",
        "project:manage",
        "project:create",
        "project:update",
        "project:delete",
        "triggers:manage",
        "gatewayLogs:view",
        "gatewayBudgets:view",
        "virtualKeys:view",
      ]) {
        expect(grants("lite-member", permission)).toBe(false);
      }
    });
  });
});
