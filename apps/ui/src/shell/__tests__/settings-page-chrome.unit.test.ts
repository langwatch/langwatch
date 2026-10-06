/**
 * Every page under Settings sits in the one chrome the application draws, never in a frame
 * of its own.
 * Spec: specs/settings/settings-page-chrome.feature
 */
import { navigationWeb } from "@langwatch/navigation-browser/declaration";
import { matchRoutes } from "react-router";
import { describe, expect, it } from "vitest";

import { uiRouteTable, type UiRouteDescriptor } from "../ui-route-table";

const { settingsMenu, isSettingsShellRoute } =
  await navigationWeb.installation.capabilities.chrome.load();

const CHROME = "chrome";
/** The frames a project or settings page legitimately nests under, below the chrome. */
const SHARED_FRAMES = new Set(["layouts/trace-drawer", "layouts/project-langy"]);

type Placement = { pattern: string; frames: string[] };

/** Every routed page with the layouts above it, outermost first; a redirect is no page. */
function placements({
  table,
  frames = [],
}: {
  table: readonly UiRouteDescriptor[];
  frames?: string[];
}): Placement[] {
  return table.flatMap((descriptor) => {
    if ("redirect" in descriptor) return [];
    const here = "layout" in descriptor ? [...frames, descriptor.layout] : [...frames];
    if ("page" in descriptor && descriptor.children) here.push(descriptor.page);
    const own: Placement[] =
      "page" in descriptor && typeof descriptor.path === "string" && !descriptor.children
        ? [{ pattern: descriptor.path, frames }]
        : [];
    return [...own, ...placements({ table: descriptor.children ?? [], frames: here })];
  });
}

const routed = placements({ table: uiRouteTable });

/** The placement the router would pick for `address`. */
function placementOf(address: string): Placement | undefined {
  const matched = matchRoutes(
    routed.map((placement) => ({ path: placement.pattern })),
    address,
  )?.[0]?.route.path;
  return routed.find((placement) => placement.pattern === matched);
}

const everythingOpen = {
  hasPermission: () => true,
  isSaaS: true,
  hasCloudOps: true,
  showEnterpriseNav: true,
  isLiteMember: false,
  hasOpsAccess: true,
  isPlatformAdmin: true,
};

describe("given every page the Settings menu can open", () => {
  const addresses = settingsMenu(everythingOpen).flatMap((group) =>
    group.items.map((item) => item.href),
  );

  it("finds the menu's pages and the route table's placements", () => {
    expect(addresses.length).toBeGreaterThanOrEqual(20);
    expect(routed.length).toBeGreaterThanOrEqual(20);
  });

  describe("when each is placed in the route table", () => {
    /** @scenario No page the Settings menu opens is left without it */
    it.each(addresses)("%s opens inside the application chrome as a settings address", (href) => {
      const placement = placementOf(href);

      expect(placement, `${href} matches no page`).toBeDefined();
      expect(placement?.pattern, `${href} fell through to the catch-all`).not.toBe("*");
      expect(placement?.frames[0]).toBe(CHROME);
      expect(isSettingsShellRoute(href)).toBe(true);
    });
  });
});

describe("given every page the route table serves under a settings section", () => {
  const settingsPages = routed.filter(
    (placement) => placement.pattern === "/settings" || placement.pattern.startsWith("/settings/"),
  );

  it("finds the settings pages, framed as the table nests them", () => {
    expect(settingsPages.length).toBeGreaterThanOrEqual(20);
    expect(placementOf("/settings/roles")?.frames).toEqual([
      CHROME,
      "layouts/trace-drawer",
      "layouts/project-langy",
    ]);
  });

  describe("when the layouts above each are read", () => {
    /** @scenario No settings page wraps itself in a second copy of the sidebar */
    it("is the one chrome and the frames every product page shares, and nothing else", () => {
      for (const { pattern, frames } of settingsPages) {
        const extra = frames.filter((frame) => frame !== CHROME && !SHARED_FRAMES.has(frame));

        expect(
          frames.filter((frame) => frame === CHROME),
          pattern,
        ).toHaveLength(1);
        expect(extra, `${pattern} re-applies a layout of its own`).toEqual([]);
      }
    });
  });
});
