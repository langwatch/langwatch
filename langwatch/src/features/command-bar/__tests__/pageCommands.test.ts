import { describe, it, expect } from "vitest";
import { getPageCommands, pageCommandRegistry } from "../pageCommands";
import { tracesPageCommands } from "../pageCommands/tracesPageCommands";

describe("pageCommands", () => {
  describe("getPageCommands", () => {
    it("returns traces page commands for messages route", () => {
      const commands = getPageCommands("/my-project/messages");
      expect(commands).toBe(tracesPageCommands);
      expect(commands.length).toBeGreaterThan(0);
    });

    it("returns empty array for unknown route", () => {
      const commands = getPageCommands("/unknown/route");
      expect(commands).toEqual([]);
    });

    it("returns empty array for settings route", () => {
      const commands = getPageCommands("/settings");
      expect(commands).toEqual([]);
    });

    it("normalizes project slug in path", () => {
      // Different project slugs should all map to the same commands
      expect(getPageCommands("/project-a/messages")).toBe(tracesPageCommands);
      expect(getPageCommands("/project-b/messages")).toBe(tracesPageCommands);
      expect(getPageCommands("/123/messages")).toBe(tracesPageCommands);
    });
  });

  describe("tracesPageCommands", () => {
    it("contains view switching commands", () => {
      const listView = tracesPageCommands.find(
        (cmd) => cmd.id === "page-traces-view-list"
      );
      const tableView = tracesPageCommands.find(
        (cmd) => cmd.id === "page-traces-view-table"
      );

      expect(listView).toBeDefined();
      expect(listView?.label).toBe("Switch to List View");

      expect(tableView).toBeDefined();
      expect(tableView?.label).toBe("Switch to Table View");
    });

    it("contains date range commands", () => {
      const date7d = tracesPageCommands.find(
        (cmd) => cmd.id === "page-traces-date-7d"
      );
      const date30d = tracesPageCommands.find(
        (cmd) => cmd.id === "page-traces-date-30d"
      );
      const today = tracesPageCommands.find(
        (cmd) => cmd.id === "page-traces-date-today"
      );

      expect(date7d).toBeDefined();
      expect(date7d?.label).toBe("Last 7 Days");

      expect(date30d).toBeDefined();
      expect(date30d?.label).toBe("Last 30 Days");

      expect(today).toBeDefined();
      expect(today?.label).toBe("Today");
    });

    it("contains clear filters command", () => {
      const clearFilters = tracesPageCommands.find(
        (cmd) => cmd.id === "page-traces-clear-filters"
      );

      expect(clearFilters).toBeDefined();
      expect(clearFilters?.label).toBe("Clear All Filters");
    });

    it("all commands have required fields", () => {
      tracesPageCommands.forEach((cmd) => {
        expect(cmd.id).toBeDefined();
        expect(cmd.label).toBeDefined();
        expect(cmd.icon).toBeDefined();
        expect(cmd.category).toBe("actions");
      });
    });

    it("all commands have keywords for search", () => {
      tracesPageCommands.forEach((cmd) => {
        expect(cmd.keywords).toBeDefined();
        expect(cmd.keywords!.length).toBeGreaterThan(0);
      });
    });
  });

  describe("pageCommandRegistry", () => {
    it("has registry for traces page", () => {
      expect(pageCommandRegistry["/[project]/messages"]).toBe(
        tracesPageCommands
      );
    });
  });
});
