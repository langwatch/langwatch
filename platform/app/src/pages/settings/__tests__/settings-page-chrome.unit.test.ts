import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every page registered under `/settings` frames itself with
 * `SettingsLayout`. A page that skips it renders with no top bar, no
 * settings menu and no page frame, which is how the email suppressions page
 * shipped: it named the layout as `withPermissionGuard`'s `layoutComponent`,
 * which frames only the refusal a reader without the permission sees.
 *
 * The list comes from the routes table rather than a directory listing, so a
 * new settings page is covered the moment it is reachable, and the component
 * files that sit next to the pages are left out.
 *
 * Spec: specs/settings/settings-page-chrome.feature
 */
const SOURCE_ROOT = join(__dirname, "..", "..", "..");

const routesSource = readFileSync(join(SOURCE_ROOT, "routes.tsx"), "utf-8");

/**
 * Every `/settings` route in the table, as the module path it loads.
 *
 * The table is cut into one chunk per route first, so a route can only be
 * paired with the module named inside its own entry, and one that names none
 * throws rather than borrowing the next route's.
 */
function registeredSettingsPageModules(): string[] {
  return routesSource
    .split(/path:\s*"/)
    .slice(1)
    .filter((entry) => entry.startsWith("/settings"))
    .map((entry) => {
      const address = entry.slice(0, entry.indexOf('"'));
      const module = /import\("\.\/(pages\/settings[^"]*)"\)/.exec(entry);
      if (!module) {
        throw new Error(`The route ${address} names no page module`);
      }
      return module[1]!;
    });
}

/** The same routes counted a second way, to hold the reading above to it. */
function declaredSettingsRouteCount(): number {
  return (routesSource.match(/path:\s*"\/settings/g) ?? []).length;
}

/** Where a route's module specifier lives on disk. */
function sourceFileOf(moduleSpecifier: string): string {
  const asFile = join(SOURCE_ROOT, `${moduleSpecifier}.tsx`);
  try {
    readFileSync(asFile);
    return asFile;
  } catch {
    return join(SOURCE_ROOT, moduleSpecifier, "index.tsx");
  }
}

describe("the pages under /settings", () => {
  const modules = registeredSettingsPageModules();

  describe("when the routes table is read", () => {
    it("finds every settings page, so the check below covers them all", () => {
      // Both counts come from the table but are read differently, so a page
      // the reading above drops is a page these two disagree about. The floor
      // catches the case where both readings break at once and the check
      // below would pass over an empty list.
      expect(declaredSettingsRouteCount()).toBeGreaterThan(20);
      expect(modules).toHaveLength(declaredSettingsRouteCount());
      expect(modules).toContain("pages/settings/email-suppressions");
    });
  });

  describe("when a settings page renders", () => {
    /** @scenario No page the Settings menu opens is left without it */
    it.each(modules)("%s renders SettingsLayout", (moduleSpecifier) => {
      const source = readFileSync(sourceFileOf(moduleSpecifier), "utf-8");

      // A page whose whole job is to forward an old address renders nothing
      // of its own, so framing it would flash a settings shell on the way
      // past. `/settings/role-bindings` is one: the page it named is now a
      // tab of Roles, and the address keeps resolving so old links do not
      // dead-end. The frame is the destination's job.
      if (source.includes("<Navigate")) return;

      expect(source).toContain("<SettingsLayout");
    });

    /** @scenario An address that only forwards is not framed on the way past */
    /** @scenario The old role bindings address forwards onto the tab it became */
    it("forwards the old role-bindings address onto the tab it became", () => {
      const source = readFileSync(
        sourceFileOf("pages/settings/role-bindings"),
        "utf-8",
      );

      expect(source).toContain("<Navigate");
      expect(source).toContain("/settings/roles?tab=assignments");
      expect(source).not.toContain("<SettingsLayout");
    });
  });
});
