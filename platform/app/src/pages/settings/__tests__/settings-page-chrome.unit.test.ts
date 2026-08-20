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

/** Every `/settings` route in the table, as the module path it loads. */
function registeredSettingsPageModules(): string[] {
  const routes = readFileSync(join(SOURCE_ROOT, "routes.tsx"), "utf-8");
  const entries = routes.matchAll(
    /path:\s*"(\/settings[^"]*)"[\s\S]{0,120}?import\("\.\/(pages\/settings[^"]*)"\)/g,
  );
  return [...entries].map((entry) => entry[2]!);
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
      // Guards the regex itself: a routes-table edit that stops matching
      // would otherwise leave this suite passing over an empty list.
      expect(modules.length).toBeGreaterThanOrEqual(23);
      expect(modules).toContain("pages/settings/email-suppressions");
    });
  });

  describe("when a settings page renders", () => {
    /** @scenario Every settings page in the routes table renders the layout */
    it.each(modules)("%s renders SettingsLayout", (moduleSpecifier) => {
      const source = readFileSync(sourceFileOf(moduleSpecifier), "utf-8");

      expect(source).toContain("<SettingsLayout");
    });
  });
});
