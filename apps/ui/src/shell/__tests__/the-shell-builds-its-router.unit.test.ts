/**
 * The crash this covers: the table named two layout keys whose files were
 * deleted with the features tree, and `createUiRouteObjects` resolves EVERY
 * key when the router is BUILT, so the first gap took the browser down at boot.
 */
import { webModules } from "@langwatch/installed-modules/web";
import { describe, expect, it } from "vitest";

import { mergeUiPageLoaders } from "../../behavior/ui-feature-loaders";
import { installedModuleScreens } from "../../behavior/ui-module-screens";
import { uiRoutePageKeys } from "../../behavior/ui-page-loaders";
import { uiRouteTable } from "../../model/ui-route-table";
import { createUiRouteObjects } from "../ui-route-objects";
import { uiUnservedPageLoaders } from "../ui-unserved-pages";

/** Composed exactly as `main.tsx` composes it. */
const loaders = mergeUiPageLoaders({
  own: installedModuleScreens(webModules).loaders,
  host: uiUnservedPageLoaders,
});

describe("given the route table and the modules this build installs", () => {
  describe("when the shell builds its router from them", () => {
    /** @scenario "The router builds from the table the shell ships" */
    it("builds, because every page key the table names has a loader", () => {
      expect(() => createUiRouteObjects({ table: uiRouteTable, loaders })).not.toThrow();
    });

    /** @scenario "An unserved page key refuses by its own name" */
    it("refuses by name when a key has no loader, rather than failing on the navigation", () => {
      expect(() => createUiRouteObjects({ table: uiRouteTable, loaders: {} })).toThrow(
        /pages\/auth\/signin/,
      );
    });
  });

  describe("when the application chrome is read back off the built router", () => {
    /** @scenario "The application chrome carries no page key" */
    it("is a pathless layout with children and no page key on its handle", () => {
      const chrome = createUiRouteObjects({ table: uiRouteTable, loaders }).find(
        (route) => route.path === void 0 && (route.children?.length ?? 0) > 0,
      );

      expect(chrome).toBeDefined();
      expect(chrome?.handle).toBeUndefined();
      expect(uiRoutePageKeys(uiRouteTable)).not.toContain("chrome");
    });
  });
});
