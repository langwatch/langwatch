/**
 * Every internal ops page the route table registers must be reachable
 * from the settings menu.
 *
 * Spec: specs/navigation/ops-navigation-v2.feature
 *
 * In the new navigation modes the settings menu is the ONLY place the
 * ops pages are offered: the product sidebars carry no ops section any
 * more. So a page that lands in the route table and not in `opsGroup()`
 * or `backofficeGroup()` has no entry anywhere, and nothing else would
 * say so. The route table is hand-maintained, and the menu is a second
 * hand-maintained table, which is exactly the pair that drifts.
 *
 * "Reachable" is read from the menu data itself rather than from a list
 * repeated here, so the menu stays the single statement of what it
 * covers: an entry claims its own address, everything under its prefix,
 * and the addresses it names in `alsoActiveAt`.
 */
import { uiRouteDescriptors, uiRouteTable } from "@langwatch/ui";
import { describe, expect, it } from "vitest";
import { backofficeGroup, opsGroup, type SettingsMenuGroup } from "../useSettingsMenu";

/**
 * Every `/ops` address the route table registers. Parameter segments are
 * dropped to their parent, since a detail page is reached from the page
 * that lists it rather than from the menu.
 */
function registeredOpsRoutes(): string[] {
  const paths = uiRouteDescriptors(uiRouteTable)
    .map((descriptor) => descriptor.path)
    .filter((declared): declared is string => declared !== void 0);
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

  // Both sides are hand-maintained tables, so a rename that empties one of
  // them would otherwise leave a test passing on nothing at all.
  it("finds the ops routes and the menu entries", () => {
    expect(addresses.length).toBeGreaterThanOrEqual(10);
    expect(addresses).toContain("/ops");
    expect(menu.flatMap((group) => group.items).length).toBeGreaterThanOrEqual(10);
  });

  describe("when each address is matched against the settings menu", () => {
    /** @scenario The settings menu reaches every internal ops page */
    it.each(addresses)("%s is claimed by a menu entry", (address) => {
      expect(isClaimedBy({ address, groups: menu })).toBe(true);
    });
  });

  describe("when the single sign-on connections entry is resolved", () => {
    const CONNECTIONS = "/ops/backoffice/sso-connections";

    /** @scenario "The connections page is reachable from the operator menu" */
    it("resolves to a route registered for that exact path", () => {
      // The menu offers it...
      const offered = backofficeGroup().items.find(
        (item) => item.href === CONNECTIONS,
      );
      expect(offered).toBeDefined();

      // ...and the route table registers that exact path, rather than the
      // link falling through to `/:project` or the catch-all. Both halves,
      // because the pair of hand-maintained tables is what drifts.
      expect(addresses).toContain(CONNECTIONS);
      expect(isClaimedBy({ address: CONNECTIONS, groups: menu })).toBe(true);
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
      expect(opsGroup().items.some((item) => item.href === address)).toBe(
        false,
      );
    });

    /** @scenario The event-sourcing tools are offered inside their workspace */
    it.each(TOOLS)("%s is claimed by the Event Sourcing entry", (address) => {
      const eventSourcing = opsGroup().items.find(
        (item) => item.label === "Event Sourcing",
      );
      if (!eventSourcing) throw new Error("no Event Sourcing menu entry");

      expect(eventSourcing.alsoActiveAt).toContain(address);
    });
  });
});
