import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { pickNavigatePage } from "../langy-navigate-pages.rules.ts";

const CATCH_ALL = "*";
const ROUTE_PATTERNS_PATH = join(
  __dirname,
  "../../../../../../apps/ui/src/shell/route-patterns.generated.json",
);
const RULES_SOURCE = readFileSync(join(__dirname, "../langy-navigate-pages.rules.ts"), "utf-8");

const patterns = (JSON.parse(readFileSync(ROUTE_PATTERNS_PATH, "utf-8")) as string[]).filter(
  (pattern) => pattern !== CATCH_ALL,
);

/** Whether the pattern serves `pathname`: `:name` is one segment, a trailing `/*` the subtree. */
function matches({ pattern, pathname }: { pattern: string; pathname: string }): boolean {
  const body = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/:[A-Za-z]+/g, "[^/]+")
    .replace(/\/\*$/, "(?:/.*)?");
  return new RegExp(`^${body}$`).test(pathname);
}

/** The `name: "path"` entries of one table, read from source so a new page is checked too. */
function tableEntries(table: string): { name: string; path: string }[] {
  const block = RULES_SOURCE.match(new RegExp(`${table}[^=]*=\\s*\\{([^}]*)\\}`))?.[1] ?? "";
  return [...block.matchAll(/"?([\w-]+)"?:\s*"([^"]+)"/g)].map(([, name, path]) => ({
    name: name ?? "",
    path: path ?? "",
  }));
}

const projectPages = tableEntries("NAVIGATE_PROJECT_PAGES");
const organizationPages = tableEntries("NAVIGATE_ORGANIZATION_PAGES");

/** The address the navigate command builds: under the slug for a project page. */
function addressOf({ name, projectSlug }: { name: string; projectSlug: string }): string | null {
  const page = pickNavigatePage(name);
  if (!page) return null;
  const withoutQuery = page.path.split("?")[0] ?? page.path;
  return page.scope === "project" ? `/${projectSlug}${withoutQuery}` : withoutQuery;
}

describe("given the shell's committed route patterns", () => {
  it("reads both page tables out of the rules file", () => {
    expect(projectPages.length).toBeGreaterThan(0);
    expect(organizationPages.length).toBeGreaterThan(0);
  });

  describe("when each page name Langy's navigate command opens is matched", () => {
    /** @scenario every page name Langy's navigate command opens is a registered route */
    it.each(projectPages)(
      "the project page $name opens a route under the project slug",
      ({ name }) => {
        const address = addressOf({ name, projectSlug: "sample" });
        expect(address).toMatch(/^\/sample\//);
        expect(patterns.some((pattern) => matches({ pattern, pathname: address ?? "" }))).toBe(
          true,
        );
      },
    );

    /** @scenario every page name Langy's navigate command opens is a registered route */
    it.each(organizationPages)(
      "the organization page $name opens a top-level route",
      ({ name }) => {
        const address = addressOf({ name, projectSlug: "sample" });
        expect(address).not.toMatch(/^\/sample\//);
        expect(patterns.some((pattern) => matches({ pattern, pathname: address ?? "" }))).toBe(
          true,
        );
      },
    );
  });
});
