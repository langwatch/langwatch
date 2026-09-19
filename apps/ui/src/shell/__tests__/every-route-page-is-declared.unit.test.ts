/**
 * A page key with no declared loader throws when the router is BUILT, so one
 * missing declaration takes the whole browser down. Nothing else composes the
 * real table against the real modules, so the gap read green until this test.
 */
import { webModules } from "@langwatch/installed-web-modules";
import { mergeUiPageLoaders,uiRoutePageKeys } from "@langwatch/ui-kernel/feature-install";
import { installedModuleScreens } from "@langwatch/ui-kernel/module-screens";
import { describe, expect, it } from "vitest";

import { uiRouteTable } from "../ui-route-table";
import { uiUnservedPageLoaders } from "../ui-unserved-pages";

/** Composed exactly as `main.tsx` composes it: module screens over the app's own. */
const moduleScreens = installedModuleScreens(webModules).loaders;
const loaders = mergeUiPageLoaders({ own: moduleScreens, host: uiUnservedPageLoaders });

describe("given the route table the shell builds its router from", () => {
  const keys = uiRoutePageKeys(uiRouteTable);

  it("finds page keys to check", () => {
    expect(keys.length).toBeGreaterThan(50);
  });

  describe("when each page key is resolved against the installed modules", () => {
    it("every one has a declared loader", () => {
      expect(keys.filter((key) => loaders[key] === void 0)).toEqual([]);
    });

    it("keeps no placeholder for a page a module has since declared", () => {
      const declared = Object.keys(uiUnservedPageLoaders).filter(
        (key) => moduleScreens[key] !== void 0,
      );
      expect(declared).toEqual([]);
    });

    it("keeps no placeholder for an address the table stopped naming", () => {
      const orphaned = Object.keys(uiUnservedPageLoaders).filter((key) => !keys.includes(key));
      expect(orphaned).toEqual([]);
    });
  });
});
