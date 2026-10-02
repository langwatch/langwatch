/**
 * Navigation's screens read the navigation host, and only the chrome layout
 * mounts it. The 404 and the `@project` forward sat at the top level, so
 * `/{slug}/not-found` threw "No NavigationHost in context".
 */
import { browserModules } from "@langwatch/installed-web-modules";
import { describe, expect, it } from "vitest";

import { uiRouteTable } from "../ui-route-table";
import type { UiRouteDescriptor } from "../ui-route-table";

/** Every page key in `table`, however deeply it nests. */
function everyPageKey(table: readonly UiRouteDescriptor[]): string[] {
  return table.flatMap((descriptor) => {
    if ("redirect" in descriptor) return [];
    const children = everyPageKey(descriptor.children ?? []);
    return "page" in descriptor ? [descriptor.page, ...children] : children;
  });
}

/** Page keys below the chrome layout. */
function pageKeysUnderChrome(table: readonly UiRouteDescriptor[]): string[] {
  return table.flatMap((descriptor) => {
    if ("redirect" in descriptor) return [];
    if ("layout" in descriptor && descriptor.layout !== void 0) {
      return descriptor.layout === "chrome" ? everyPageKey(descriptor.children ?? []) : [];
    }
    return pageKeysUnderChrome(descriptor.children ?? []);
  });
}

const navigationScreenKeys = Object.keys(
  browserModules.find((module) => module.name === "navigation")?.installation.screens ?? {},
);

describe("given the screens the navigation module declares", () => {
  it("finds the landing, the 404 and the @project forward among them", () => {
    expect(navigationScreenKeys).toEqual(
      expect.arrayContaining(["pages/index", "pages/not-found", "pages/@project/[...path]/index"]),
    );
  });

  describe("when each is located in the route table", () => {
    /** @scenario "An address that names nothing draws the 404 inside the chrome" */
    it("every one sits under the chrome layout, which is what mounts the navigation host", () => {
      const mounted = new Set(pageKeysUnderChrome(uiRouteTable));

      expect(navigationScreenKeys.filter((key) => !mounted.has(key))).toEqual([]);
    });

    it("keeps the catch-all as the chrome's last child", () => {
      const chrome = uiRouteTable.find(
        (descriptor) => "layout" in descriptor && descriptor.layout === "chrome",
      );
      const children = chrome && "children" in chrome ? (chrome.children ?? []) : [];

      expect(children.at(-1)).toEqual({ path: "*", page: "pages/not-found" });
    });
  });
});
