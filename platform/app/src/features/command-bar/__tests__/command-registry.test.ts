import { describe, it, expect } from "vitest";
import {
  filterCommands,
  navigationCommands,
  actionCommands,
  supportCommands,
  themeCommands,
  allStaticCommands,
} from "../command-registry";

describe("command-registry", () => {
  describe("filterCommands", () => {
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
      expect(result.some((cmd) => cmd.id === "nav-traces")).toBe(true);
    });

    it("filters commands by keyword match", () => {
      const result = filterCommands(navigationCommands, "logs");
      expect(result.length).toBeGreaterThan(0);
      expect(result.some((cmd) => cmd.id === "nav-traces")).toBe(true);
    });

    it("filters commands by description match", () => {
      const result = filterCommands(navigationCommands, "analytics dashboard");
      expect(result.length).toBeGreaterThan(0);
      expect(result.some((cmd) => cmd.id === "nav-analytics")).toBe(true);
    });

    it("is case-insensitive", () => {
      const result = filterCommands(navigationCommands, "TRACES");
      expect(result.some((cmd) => cmd.id === "nav-traces")).toBe(true);
    });

    it("returns empty array when no matches", () => {
      const result = filterCommands(navigationCommands, "nonexistent");
      expect(result).toHaveLength(0);
    });
  });

  describe("navigationCommands", () => {
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
      const settings = navigationCommands.find(
        (cmd) => cmd.id === "nav-settings"
      );
      expect(settings).toBeDefined();
      expect(settings?.path).toBe("/settings");
    });
  });

  describe("actionCommands", () => {
    it("has required properties for all commands", () => {
      for (const cmd of actionCommands) {
        expect(cmd.id).toBeDefined();
        expect(cmd.label).toBeDefined();
        expect(cmd.icon).toBeDefined();
        expect(cmd.category).toBe("actions");
      }
    });

    it("includes new agent command", () => {
      const newAgent = actionCommands.find(
        (cmd) => cmd.id === "action-new-agent"
      );
      expect(newAgent).toBeDefined();
    });

    it("includes new evaluation command", () => {
      const newEval = actionCommands.find(
        (cmd) => cmd.id === "action-new-evaluation"
      );
      expect(newEval).toBeDefined();
    });
  });

  describe("allStaticCommands", () => {
    it("combines navigation, action, support, and theme commands", () => {
      expect(allStaticCommands.length).toBe(
        navigationCommands.length +
          actionCommands.length +
          supportCommands.length +
          themeCommands.length
      );
    });
  });
});
