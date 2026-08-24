import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { noOrgBouncerRoutes } from "~/hooks/useRequiredSession";

import { governanceNavItems } from "../sectionNavItems";

// vitest runs from the app package root.
const SRC = resolve(process.cwd(), "src");

/**
 * Files that must keep naming retired addresses on purpose: the redirect
 * routes themselves, and the compatibility map that recognises old addresses
 * coming in from stored pins.
 */
const ALLOWED = [
  resolve(SRC, "routes.tsx"),
  // Recognises retired addresses arriving from stored pins.
  resolve(SRC, "utils/compat/next-router.ts"),
  resolve(SRC, "hooks/useRequiredSession.ts"),
];

/** Retired addresses no live link may carry any more. */
const RETIRED = ["/governance/departments", "/governance/tool-catalog"];

const tsFiles = (dir: string): string[] => {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "generated" || entry === "__tests__") continue;
      found.push(...tsFiles(full));
    } else if (/\.tsx?$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
};

describe("given the governance sidebar renames", () => {
  describe("when the governance navigation items are captured", () => {
    // @scenario "The sidebar names People where it named Departments"
    it("names People at /governance/people and keeps no departments item", () => {
      const people = governanceNavItems.find(
        (item) => item.href === "/governance/people",
      );
      expect(people?.label).toBe("People");
      expect(
        governanceNavItems.some((item) =>
          item.href.startsWith("/governance/departments"),
        ),
      ).toBe(false);
    });
  });

  describe("when every navigation link to a renamed page is inspected", () => {
    // @scenario "Every internal link follows the rename"
    it("carries no link to a retired address outside compatibility maps", () => {
      const offenders = tsFiles(SRC)
        .filter((file) => !ALLOWED.includes(file))
        .filter((file) =>
          RETIRED.some((retired) =>
            readFileSync(file, "utf8").includes(retired),
          ),
        );

      expect(offenders).toEqual([]);
    });
  });

  describe("when the allowlist of pages reachable without a project is read", () => {
    // @scenario "An admin in an empty organization still reaches the renamed page"
    it("lists the people page under its new address", () => {
      expect(noOrgBouncerRoutes).toContain("/governance/people");
    });
  });

  describe("when the item lists are captured for the inventory unification", () => {
    // @scenario "The sidebar offers Inventory as one door instead of two"
    it("offers one Inventory item and keeps no retired list items", () => {
      const inventory = governanceNavItems.filter(
        (item) => item.label === "Inventory",
      );
      expect(inventory).toHaveLength(1);
      expect(inventory[0]?.href).toBe("/governance/inventory");

      const retiredListAddresses = [
        "/governance/tool-catalog",
        "/governance/ingestion-sources",
      ];
      for (const href of retiredListAddresses) {
        expect(
          governanceNavItems.some((item) => item.href === href),
        ).toBe(false);
      }
    });
  });
});
