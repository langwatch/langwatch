import { describe, expect, it } from "vitest";

import {
  actionCommands,
  allStaticCommands,
  filterCommands,
  navigationCommands,
  supportCommands,
  themeCommands,
  topLevelNavigationCommands,
} from "../command-catalogue.ts";

describe("command-registry", () => {
  describe("when filtering commands", () => {
    it("returns all commands when query is empty", () => {
      const result = filterCommands(navigationCommands, "");
      expect(result).toEqual(navigationCommands);
    });

    it("returns all commands when query is whitespace only", () => {
      const result = filterCommands(navigationCommands, "   ");
      expect(result).toEqual(navigationCommands);
    });

    it("filters commands by label match", () => {
      const result = filterCommands(navigationCommands, "traces");
      expect(result.length).toBeGreaterThan(0);
      expect(result.some((cmd) => cmd.id === "nav-traces-v2")).toBe(true);
    });

    it("filters commands by keyword match", () => {
      const result = filterCommands(navigationCommands, "logs");
      expect(result.length).toBeGreaterThan(0);
      expect(result.some((cmd) => cmd.id === "nav-traces-v2")).toBe(true);
    });

    it("filters commands by description match", () => {
      const result = filterCommands(navigationCommands, "analytics dashboard");
      expect(result.length).toBeGreaterThan(0);
      expect(result.some((cmd) => cmd.id === "nav-analytics")).toBe(true);
    });

    it("is case-insensitive", () => {
      const result = filterCommands(navigationCommands, "TRACES");
      expect(result.some((cmd) => cmd.id === "nav-traces-v2")).toBe(true);
    });

    it("returns empty array when no matches", () => {
      const result = filterCommands(navigationCommands, "nonexistent");
      expect(result).toHaveLength(0);
    });
  });

  describe("given the navigation commands", () => {
    it("has required properties for all commands", () => {
      for (const cmd of navigationCommands) {
        expect(cmd.id).toBeDefined();
        expect(cmd.label).toBeDefined();
        expect(cmd.icon).toBeDefined();
        expect(cmd.category).toBe("navigation");
        expect(cmd.path).toBeDefined();
      }
    });

    it("includes home command", () => {
      const home = navigationCommands.find((cmd) => cmd.id === "nav-home");
      expect(home).toBeDefined();
      expect(home?.path).toBe("/[project]");
    });

    it("includes settings command", () => {
      const settings = navigationCommands.find((cmd) => cmd.id === "nav-settings");
      expect(settings).toBeDefined();
      expect(settings?.path).toBe("/settings");
    });

    it("points the folded settings pages at the Directory tab they became", () => {
      const pathOf = (id: string) => navigationCommands.find((cmd) => cmd.id === id)?.path;
      expect(pathOf("nav-settings-members")).toBe("/settings/directory");
      expect(pathOf("nav-settings-teams")).toBe("/settings/directory?tab=teams");
      expect(pathOf("nav-settings-projects")).toBe("/settings/directory?tab=teams");
      expect(pathOf("nav-settings-groups")).toBe("/settings/directory?tab=groups");
    });

    it("offers the settings pages main lists", () => {
      const ids = navigationCommands.map((cmd) => cmd.id);
      for (const id of [
        "nav-settings-directory",
        "nav-settings-provisioning",
        "nav-settings-access",
        "nav-settings-api-keys",
        "nav-settings-security",
        "nav-settings-profile",
      ]) {
        expect(ids).toContain(id);
      }
    });

    it("keeps both evaluation workflows in top-level navigation", () => {
      const ids = topLevelNavigationCommands.map((command) => command.id);
      expect(ids).toContain("nav-online-evaluations");
      expect(ids).toContain("nav-experiments");
      expect(ids).not.toContain("nav-evaluations");
    });
  });

  describe("given the action commands", () => {
    it("has required properties for all commands", () => {
      for (const cmd of actionCommands) {
        expect(cmd.id).toBeDefined();
        expect(cmd.label).toBeDefined();
        expect(cmd.icon).toBeDefined();
        expect(cmd.category).toBe("actions");
      }
    });

    it("includes new agent command", () => {
      const newAgent = actionCommands.find((cmd) => cmd.id === "action-new-agent");
      expect(newAgent).toBeDefined();
    });

    it("includes new evaluation command", () => {
      const newEval = actionCommands.find((cmd) => cmd.id === "action-new-evaluation");
      expect(newEval).toBeDefined();
    });
  });

  describe("given all static commands", () => {
    it("combines navigation, action, support, and theme commands", () => {
      expect(allStaticCommands.length).toBe(
        navigationCommands.length +
          actionCommands.length +
          supportCommands.length +
          themeCommands.length,
      );
    });
  });
});
