/**
 * `checkHostMounts` asks whether a host is mounted ANYWHERE. A host the shell
 * mounts as a layout is only mounted above the routes under that layout, and
 * nothing checked that. Spec: specs/ui/module-host-mounting.feature
 */
import { webModules } from "@langwatch/installed-web-modules";
import { describe, expect, it } from "vitest";

import { uiRouteTable } from "../ui-route-table";
import type { UiRouteDescriptor, UiShellLayout } from "../ui-route-table";

/** Page keys below one shell layout, however deeply the table nests them. */
function pageKeysUnderLayout(table: readonly UiRouteDescriptor[], layout: UiShellLayout): string[] {
  return table.flatMap((descriptor) => {
    if ("redirect" in descriptor) return [];
    if ("layout" in descriptor && descriptor.layout !== void 0) {
      return descriptor.layout === layout ? everyPageKey(descriptor.children ?? []) : [];
    }
    return pageKeysUnderLayout(descriptor.children ?? [], layout);
  });
}

function everyPageKey(table: readonly UiRouteDescriptor[]): string[] {
  return table.flatMap((descriptor) =>
    "redirect" in descriptor || !("page" in descriptor)
      ? everyPageKey(("children" in descriptor && descriptor.children) || [])
      : [descriptor.page, ...everyPageKey(descriptor.children ?? [])],
  );
}

const authScreenKeys = Object.keys(
  webModules.find((module) => module.name === "auth")?.installation.screens ?? {},
);

describe("given the screens the auth module declares", () => {
  it("finds them, so a rename cannot make this test vacuous", () => {
    expect(authScreenKeys.length).toBeGreaterThan(5);
  });

  describe("when each is located in the route table", () => {
    /** @scenario "A module's host is mounted above the page that reads it" */
    it("every one sits under the auth layout, which is what mounts AuthHostApi", () => {
      // `/invite/accept` was declared at the top level while reading auth's
      // host, so it threw AuthHostUnavailableError the moment anyone opened an
      // invitation — and the host was mounted, just not above that route.
      const mounted = new Set(pageKeysUnderLayout(uiRouteTable, "auth"));

      expect(authScreenKeys.filter((key) => !mounted.has(key))).toEqual([]);
    });
  });
});
