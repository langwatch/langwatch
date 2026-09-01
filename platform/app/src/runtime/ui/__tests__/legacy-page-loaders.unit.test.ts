/**
 * @vitest-environment jsdom
 *
 * The install list and the route table are two halves of one seam: the table
 * names a page, this application supplies the module. A key in the table with
 * no loader is a page that 404s the moment someone opens its URL; a loader
 * with no key in the table is a page nothing can reach any more.
 */

import { uiRoutePageKeys, uiRouteTable } from "@langwatch/ui";
import { describe, expect, it } from "vitest";
import { legacyPageLoaders } from "../legacy-page-loaders";

describe("given the browser route table and this application's page loaders", () => {
  describe("when the two are compared", () => {
    it("registers a loader for every page the table names", () => {
      const missing = uiRoutePageKeys(uiRouteTable).filter((key) => !(key in legacyPageLoaders));

      expect(missing).toEqual([]);
    });

    it("registers nothing the table does not name", () => {
      const named = new Set(uiRoutePageKeys(uiRouteTable));
      const unreachable = Object.keys(legacyPageLoaders).filter((key) => !named.has(key));

      expect(unreachable).toEqual([]);
    });

    it("compares the whole surface rather than two empty lists", () => {
      expect(uiRoutePageKeys(uiRouteTable).length).toBeGreaterThan(100);
      expect(Object.keys(legacyPageLoaders).length).toBeGreaterThan(100);
    });
  });
});
