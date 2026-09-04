/**
 * Every page registered under `/settings` renders inside the settings
 * chrome — the top bar, the settings sidebar and the page frame —
 * `platform/app`'s `SettingsLayout` is not, so a page that opens outside a
 * matched apps/ui route renders on an empty background with no menu and no
 * way back, which is how the email suppressions page shipped: it named the
 * layout as `withPermissionGuard`'s `layoutComponent`, which frames only the
 * refusal a reader without the permission sees.
 *
 * THE CHROME IS NO LONGER A PER-PAGE OPT-IN. `platform/app` is deleted, so
 * every `/settings` address is now served by this application's own route
 * table, and `NavigationShell` (mounted once by the chrome route for every
 * matched page) draws the settings sidebar for it unconditionally —
 * `resolveShellRoute`'s `isSettingsRoute` is a path test
 * (`/settings`, `/ops`), not a flag a route sets. A page-level
 * `settingsLayout: true` used to wrap the screen in a second copy of that
 * same sidebar, nested inside the first — see
 * `apps/ui/src/ui/sections/ui-page.tsx`. What is worth pinning now is that
 * every settings page really is a matched apps/ui route (so it gets the
 * shared chrome at all) and that no route file reintroduces the page-level
 * wrapper that duplicated it.
 *
 * The list still comes from the route table rather than a directory listing, so
 * a new settings page is covered the moment it is reachable, and the component
 * files that sit beside the pages are left out.
 *
 * Spec: specs/settings/settings-page-chrome.feature
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { installedUiFeatures } from "../src/features/installed-ui-features";
import {
  uiRouteDescriptors,
  uiRouteTable,
  type UiPageRouteDescriptor,
  type UiRouteDescriptor,
} from "../src/model/ui-route-table";

const here = dirname(fileURLToPath(import.meta.url));
const UI_SOURCE_ROOT = resolve(here, "..", "src");

/**
 * Every `/settings` route in the table, as the page key it loads.
 *
 * A retired `/settings` address that forwards elsewhere renders no page and
 * frames nothing, so it is not one of these. A `/settings` route that names a
 * page outside `pages/settings` throws rather than being skipped quietly.
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
 * The same routes counted a second way — over the serialised table rather than
 * the walk above — so a walk that silently drops a branch disagrees with a flat
 * read of the same data.
 */
function declaredSettingsRouteCount(): number {
  return (JSON.stringify(uiRouteTable).match(/"path":"\/settings[^"]*","page"/g) ?? []).length;
}

/** Whether this application serves the key itself, so the shared shell wraps it. */
function servedHere(pageKey: string): boolean {
  return Object.keys(installedUiFeatures.loaders ?? {}).includes(pageKey);
}

/**
 * The routes sections of every frontend feature that serves a settings page.
 *
 * Read as source rather than mounted: what is under test is that no route
 * file reintroduces a page-level settings wrapper, and a mount would
 * additionally need a session, a transport and a router to say so.
 */
function settingsRouteSections(): Map<string, string> {
  const sections = new Map<string, string>();
  for (const feature of [
    "annotation-scores",
    "api-key",
    "authz",
    "billing",
    "data-retention",
    "data-privacy",
    "github",
    "licensing",
    "model-provider",
    "notification",
    "organization",
    "personal-workspace",
    "project",
    "scim",
    "secret",
    "topic",
  ]) {
    sections.set(
      feature,
      readFileSync(
        join(UI_SOURCE_ROOT, "features", feature, "ui", "sections", `${feature}-routes.tsx`),
        "utf-8",
      ),
    );
  }
  return sections;
}

describe("the pages under /settings", () => {
  const modules = registeredSettingsPageModules();

  describe("when the routes table is read", () => {
    it("finds every settings page, so the check below covers them all", () => {
      // Both counts come from the table but are read differently — a structural
      // walk and a flat read of the serialised data — so a page one of them
      // drops is a page these two disagree about. The floor catches the case
      // where both readings break at once and the check below would pass over
      // an empty list.
      expect(declaredSettingsRouteCount()).toBeGreaterThan(20);
      expect(modules).toHaveLength(declaredSettingsRouteCount());
      expect(modules).toContain("pages/settings/email-suppressions");
      // And the two this application serves itself, so a family that quietly
      // stopped serving its key would not read as "nothing to check".
      expect(modules).toContain("pages/settings/data-retention");
      expect(modules).toContain("pages/settings/data-privacy");
      expect(modules).toContain("pages/settings/model-providers");
      expect(modules).toContain("pages/settings/model-costs");
      expect(modules).toContain("pages/settings/roles");
      expect(modules).toContain("pages/settings/role-bindings");
      expect(modules).toContain("pages/settings/api-keys");
      expect(modules).toContain("pages/settings/secrets");
      expect(modules).toContain("pages/settings/audit-log");
      expect(modules).toContain("pages/settings/authentication");
    });
  });

  describe("when a settings page renders", () => {
    /** @scenario No page the Settings menu opens is left without it */
    it.each(modules)("%s is a matched route, so the shared shell frames it", (moduleSpecifier) => {
      // `platform/app` is gone: every settings page is served here now, which
      // is what puts it under the chrome route and its `NavigationShell`.
      expect(servedHere(moduleSpecifier)).toBe(true);
    });

    /** @scenario No settings page wraps itself in a second copy of the sidebar */
    it("finds no route file re-applying a page-level settings layout", () => {
      for (const [feature, source] of settingsRouteSections()) {
        expect(source, `${feature}-routes.tsx`).not.toMatch(
          /settingsLayout\s*:\s*true|withUiSettingsLayout/,
        );
      }
    });
  });
});
