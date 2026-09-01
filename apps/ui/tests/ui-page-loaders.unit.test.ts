import { describe, expect, it } from "vitest";
import { resolveUiPageLoader, uiRoutePageKeys } from "../src/behavior/ui-page-loaders";
import type { UiRouteDescriptor } from "../src/model/ui-route-table";

const table: readonly UiRouteDescriptor[] = [
  { path: "/one", page: "pages/one" },
  {
    page: "layouts/shell",
    children: [
      { path: "/two", page: "pages/two" },
      { path: "/old", redirect: { from: "/old", to: "/two" } },
      { path: "/two-again", page: "pages/two" },
    ],
  },
];

describe("given a route table and an install list of page loaders", () => {
  describe("when the table's page keys are collected", () => {
    it("walks children and keeps the first order without repeats", () => {
      expect(uiRoutePageKeys(table)).toEqual(["pages/one", "layouts/shell", "pages/two"]);
    });
  });

  describe("when a registered key is resolved", () => {
    it("hands back the loader the application installed", () => {
      const loader = async () => ({ default: () => null });

      expect(resolveUiPageLoader({ registry: { "pages/one": loader }, key: "pages/one" })).toBe(
        loader,
      );
    });
  });

  describe("when the install list does not cover the table", () => {
    it("refuses at composition time and names the missing key", () => {
      expect(() => resolveUiPageLoader({ registry: {}, key: "pages/one" })).toThrow(
        'No page loader is registered for route page "pages/one".',
      );
    });
  });
});
