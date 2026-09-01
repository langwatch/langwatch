import {
  uiRouteDescriptors,
  uiRouteTable,
  type UiPageRouteDescriptor,
  type UiRouteDescriptor,
} from "@langwatch/ui";
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
 * The list comes from the route table rather than a directory listing, so a
 * new settings page is covered the moment it is reachable, and the component
 * files that sit next to the pages are left out.
 *
 * Spec: specs/settings/settings-page-chrome.feature
 */
const SOURCE_ROOT = join(__dirname, "..", "..", "..");

/**
 * Every `/settings` route in the table, as the page key it loads.
 *
 * A retired `/settings` address that forwards elsewhere renders no page and
 * frames nothing, so it is not one of these. A `/settings` route that names
 * a page outside `pages/settings` throws rather than being skipped quietly.
 */
function registeredSettingsPageModules(): string[] {
  return uiRouteDescriptors(uiRouteTable)
    .filter((descriptor: UiRouteDescriptor) => descriptor.path?.startsWith("/settings") === true)
    .filter((descriptor): descriptor is UiPageRouteDescriptor => !("redirect" in descriptor))
    .map((descriptor) => {
      if (!descriptor.page.startsWith("pages/settings")) {
        throw new Error(
          `The route ${String(descriptor.path)} names ${descriptor.page}, which is not a settings page`,
        );
      }
      return descriptor.page;
    });
}

/**
 * The same routes counted a second way — over the serialised table rather
 * than the walk above — so a walk that silently drops a branch disagrees with
 * a flat read of the same data.
 */
function declaredSettingsRouteCount(): number {
  return (JSON.stringify(uiRouteTable).match(/"path":"\/settings[^"]*","page"/g) ?? []).length;
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
      // Both counts come from the table but are read differently — a
      // structural walk and a flat read of the serialised data — so a page
      // one of them drops is a page these two disagree about. The floor
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

      expect(source).toContain("<SettingsLayout");
    });
  });
});
