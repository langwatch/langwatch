import { Star } from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";
import { getPageCommands, pageCommandRegistry } from "../command-page-commands";
import type { Command } from "../command-bar-types";

/**
 * The registry ships empty — the legacy Traces page was the only page that
 * ever registered commands, and it is gone. What still has to work is the
 * lookup: a concrete URL (`/acme/widgets`) has to resolve to the entry
 * registered under the route pattern (`/[project]/widgets`), whatever the
 * project slug and whether or not the path carries a trailing slash.
 */
const widgetCommands: Command[] = [
  {
    id: "page-widgets-example",
    label: "Example",
    icon: Star,
    category: "actions",
    keywords: ["example"],
  },
];

function registerWidgetsPage() {
  pageCommandRegistry["/[project]/widgets"] = widgetCommands;
}

describe("getPageCommands", () => {
  afterEach(() => {
    delete pageCommandRegistry["/[project]/widgets"];
  });

  describe("when the route has commands registered", () => {
    it("resolves a concrete path to the route pattern's commands", () => {
      registerWidgetsPage();

      expect(getPageCommands("/my-project/widgets")).toBe(widgetCommands);
    });

    it("resolves the same commands whatever the project slug is", () => {
      registerWidgetsPage();

      expect(getPageCommands("/project-a/widgets")).toBe(widgetCommands);
      expect(getPageCommands("/project-b/widgets")).toBe(widgetCommands);
      expect(getPageCommands("/123/widgets")).toBe(widgetCommands);
    });

    it("ignores a trailing slash", () => {
      registerWidgetsPage();

      expect(getPageCommands("/my-project/widgets/")).toBe(widgetCommands);
    });
  });

  describe("when the route has nothing registered", () => {
    it("returns no commands for an unknown project route", () => {
      expect(getPageCommands("/unknown/route")).toEqual([]);
    });

    it("returns no commands for a non-project route", () => {
      expect(getPageCommands("/settings")).toEqual([]);
    });

    it("returns no commands for the removed legacy Traces path", () => {
      expect(getPageCommands("/my-project/messages")).toEqual([]);
    });
  });
});
