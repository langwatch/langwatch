/**
 * Every page registered under `/settings` frames itself with the settings
 * chrome. A page that skips it renders with no top bar, no settings menu and
 * no page frame, which is how the email suppressions page shipped: it named
 * the layout as `withPermissionGuard`'s `layoutComponent`, which frames only
 * the refusal a reader without the permission sees.
 *
 * THE GUARD MOVED HERE WITH THE FIRST SETTINGS FAMILY, and it had to. It was
 * `platform/app/src/pages/settings/__tests__/settings-page-chrome.unit.test.ts`,
 * and it worked by reading each page key's source file out of
 * `platform/app/src/pages/settings`. Two of those files are now a screen in a
 * feature package and a loader in this application, so the read finds nothing
 * and the case fails for a page that is in fact framed. The invariant now spans
 * two source trees, so it is stated where the route table is — this package
 * owns it — and each key is checked against whichever half serves it.
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
const LEGACY_SOURCE_ROOT = resolve(here, "..", "..", "..", "platform", "app", "src");

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

/** Whether this application serves the key itself rather than the legacy host. */
function servedHere(pageKey: string): boolean {
  return Object.keys(installedUiFeatures.loaders ?? {}).includes(pageKey);
}

/** Where a legacy page's module specifier lives on disk. */
function legacySourceOf(moduleSpecifier: string): string {
  const asFile = join(LEGACY_SOURCE_ROOT, `${moduleSpecifier}.tsx`);
  try {
    readFileSync(asFile);
    return asFile;
  } catch {
    return join(LEGACY_SOURCE_ROOT, moduleSpecifier, "index.tsx");
  }
}

/**
 * The routes sections of every frontend feature that serves a settings page.
 *
 * Read as source rather than mounted, exactly as the legacy half is: what is
 * under test is that the wrapper is APPLIED, and a mount would additionally
 * need a session, a transport and a router to say so.
 */
function settingsRouteSections(): Map<string, string> {
  const sections = new Map<string, string>();
  for (const feature of ["data-retention", "data-privacy"]) {
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
    });
  });

  describe("when a settings page renders", () => {
    /** @scenario No page the Settings menu opens is left without it */
    it.each(modules)("%s frames itself in the settings chrome", (moduleSpecifier) => {
      if (servedHere(moduleSpecifier)) {
        const wrapped = [...settingsRouteSections().values()].filter(
          (source) =>
            source.includes(`"${moduleSpecifier}"`) &&
            // The open parenthesis is what separates APPLYING the wrapper from
            // merely importing it — the same distinction `<SettingsLayout` drew
            // on the legacy side, where an import line could never match it.
            source.includes("withUiSettingsLayout("),
        );
        expect(wrapped).toHaveLength(1);
        return;
      }

      expect(readFileSync(legacySourceOf(moduleSpecifier), "utf-8")).toContain("<SettingsLayout");
    });
  });
});
