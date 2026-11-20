/**
 * Keeps one project picker: a second "Switch project" menu grew in a module once and
 * drifted from the top bar's (no search, no tick).
 * Spec: specs/navigation/one-project-picker.feature
 * @vitest-environment node
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const ROOTS = [
  join(REPO_ROOT, "apps/ui/src"),
  join(REPO_ROOT, "modules"),
  join(REPO_ROOT, "enterprise/modules"),
].filter((root) => existsSync(root));

/** The picker's own copy: a file carrying either draws a project switch of its own. */
const PICKER_COPY = /["'`](?:Switch project|Search projects)["'`:]/;

const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "__tests__", "testing"]);

function browserSources(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    if (SKIPPED_DIRECTORIES.has(entry) || entry.startsWith(".")) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) browserSources(path, found);
    else if (/\.tsx?$/.test(entry) && !/\.(test|stories)\.tsx?$/.test(entry)) found.push(path);
  }
  return found;
}

describe("the project picker", () => {
  /** @scenario "Every project switch is the design system's one picker" */
  it("is drawn only by the design system, never by a module of its own", () => {
    const owners = ROOTS.flatMap((root) => browserSources(root))
      .filter((path) => path.includes("/browser/src/") || path.includes("apps/ui/src"))
      .filter((path) => PICKER_COPY.test(readFileSync(path, "utf8")))
      .map((path) => relative(REPO_ROOT, path));

    expect(owners).toEqual([]);
  });
});
