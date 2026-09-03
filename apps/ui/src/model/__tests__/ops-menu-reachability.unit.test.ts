/**
 * Every internal ops page the route table registers must be reachable
 * from the settings menu.
 *
 * Spec: specs/navigation/ops-navigation-v2.feature
 *
 * In the current navigation the settings menu is the ONLY place the ops
 * pages are offered: the product sidebars carry no ops section any more. So
 * a page that lands in `ui-route-table.ts` and not in `opsGroup()` or
 * `backofficeGroup()` has no entry anywhere, and nothing else would say so.
 * The route table and the menu are both hand-maintained, which is exactly
 * the pair that drifts.
 *
 * "Reachable" is read from the menu data itself rather than from a list
 * repeated here, so the menu stays the single statement of what it covers:
 * an entry claims its own address, everything under its prefix, and the
 * addresses it names in `alsoActiveAt`.
 */
import { describe, expect, it } from "vitest";
import {
  backofficeGroup,
  isSettingsMenuItemActive,
  opsGroup,
  type SettingsMenuGroup,
} from "@langwatch/navigation-web/chrome";
import { uiRouteDescriptors, uiRouteTable } from "../ui-route-table";

/**
 * Every `/ops` address the route table registers. Parameter segments are
 * dropped to their parent, since a detail page is reached from the page
 * that lists it rather than from the menu.
 */
function registeredOpsRoutes(): string[] {
  const paths = uiRouteDescriptors(uiRouteTable)
    .map((descriptor) => descriptor.path)
    .filter((path): path is string => typeof path === "string");
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
    group.items.some((item) => isSettingsMenuItemActive({ item, pathname: address })),
  );
}

describe("given the internal ops pages the route table registers", () => {
  const addresses = registeredOpsRoutes();
  const menu = [opsGroup(), backofficeGroup()];

  // Both readings are of hand-maintained tables, so a rename that stops one
  // matching would otherwise leave a test passing on nothing at all.
  it("finds the ops routes and the menu entries", () => {
    expect(addresses.length).toBeGreaterThanOrEqual(5);
    expect(addresses).toContain("/ops");
    expect(menu.flatMap((group) => group.items).length).toBeGreaterThanOrEqual(5);
  });

  describe("when each address is matched against the settings menu", () => {
    /** @scenario The settings menu reaches every internal ops page */
    it.each(addresses)("%s is claimed by a menu entry", (address) => {
      expect(isClaimedBy({ address, groups: menu })).toBe(true);
    });
  });

  describe("when the event-sourcing tools are looked for", () => {
    const TOOLS = ["/ops/projections", "/ops/blobs", "/ops/dejaview"];

    /** @scenario The event-sourcing tools are offered inside their workspace */
    it.each(TOOLS)("%s is not a top-level ops entry", (address) => {
      // The menu lists workspaces, not every tool inside one. Claiming an
      // address through `alsoActiveAt` is how a workspace owns a page that
      // does not sit under its prefix — an entry of its own here would put
      // the tool back in the menu, which is what this change removed.
      expect(opsGroup().items.some((item) => item.href === address)).toBe(false);
    });

    /** @scenario The event-sourcing tools are offered inside their workspace */
    it.each(TOOLS)("%s is claimed by the Event Sourcing entry", (address) => {
      const eventSourcing = opsGroup().items.find((item) => item.label === "Event Sourcing");
      if (!eventSourcing) throw new Error("no Event Sourcing menu entry");

      expect(eventSourcing.alsoActiveAt).toContain(address);
    });
  });
});
