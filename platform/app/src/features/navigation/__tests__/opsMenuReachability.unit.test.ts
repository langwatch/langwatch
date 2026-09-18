/**
 * Every internal ops page the route table registers must be reachable
 * from the settings menu.
 *
 * Spec: specs/navigation/ops-navigation-v2.feature
 *
 * In the new navigation modes the settings menu is the ONLY place the
 * ops pages are offered: the product sidebars carry no ops section any
 * more. So a page that lands in `routes.tsx` and not in `opsGroup()` or
 * `backofficeGroup()` has no entry anywhere, and nothing else would say
 * so. `routes.tsx` is a hand-maintained table, and the menu is a second
 * hand-maintained table, which is exactly the pair that drifts.
 *
 * "Reachable" is read from the menu data itself rather than from a list
 * repeated here, so the menu stays the single statement of what it
 * covers: an entry claims its own address, everything under its prefix,
 * and the addresses it names in `alsoActiveAt`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  backofficeGroup,
  opsGroup,
  type SettingsMenuGroup,
} from "../useSettingsMenu";

const ROUTES_PATH = path.join(__dirname, "../../../routes.tsx");

/**
 * Every `/ops` address the route table registers. Parameter segments are
 * dropped to their parent, since a detail page is reached from the page
 * that lists it rather than from the menu.
 */
function registeredOpsRoutes(): string[] {
  const source = readFileSync(ROUTES_PATH, "utf-8");
  const paths = [...source.matchAll(/\bpath:\s*"([^"]+)"/g)].map((m) => m[1]!);
  return [
    ...new Set(
      paths
        .filter((p) => p === "/ops" || p.startsWith("/ops/"))
        .map((p) => p.replace(/\/:[^/]+$/, "")),
    ),
  ].sort();
}

/** Whether some entry in the menu answers for this address. */
function isClaimedBy({
  address,
  groups,
}: {
  address: string;
  groups: SettingsMenuGroup[];
}): boolean {
  return groups.some((group) =>
    group.items.some((item) => {
      if (item.alsoActiveAt?.includes(address)) return true;
      if (item.isExactMatch) return address === item.href;
      const base = item.includePath ?? item.href;
      return address === base || address.startsWith(`${base}/`);
    }),
  );
}

describe("given the internal ops pages the route table registers", () => {
  const addresses = registeredOpsRoutes();
  const menu = [opsGroup(), backofficeGroup()];

  // Both readings are of hand-maintained tables, so a rename that stops
  // one matching would otherwise leave a test passing on nothing at all.
  it("finds the ops routes and the menu entries", () => {
    expect(addresses.length).toBeGreaterThanOrEqual(10);
    expect(addresses).toContain("/ops");
    expect(menu.flatMap((group) => group.items).length).toBeGreaterThanOrEqual(
      10,
    );
  });

  describe("when each address is matched against the settings menu", () => {
    /** @scenario The settings menu reaches every internal ops page */
    it.each(addresses)("%s is claimed by a menu entry", (address) => {
      expect(isClaimedBy({ address, groups: menu })).toBe(true);
    });
  });
});
