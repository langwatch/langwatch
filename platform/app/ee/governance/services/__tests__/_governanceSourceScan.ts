// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Where the governance static scans look, and what they refuse to look at.
 *
 * Two guards in this directory read the app's source rather than run it — one
 * proves no request path can reach the name scorer, the other proves nothing
 * books the match engine on a calendar. Both answer their question by walking
 * the same two trees under the same exclusions, and both fail in the silent
 * direction: a walker that returns fewer files than it should reports the same
 * clean result as a codebase with nothing to find. Sharing one walker means a
 * correction to what "every source file" means lands in both guards at once
 * instead of in whichever one its author had open.
 *
 * Not a test file (underscore prefix + no `.test.ts` suffix) so vitest does not
 * pick it up as a suite.
 */
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** `…/ee/governance/services/__tests__` → `…/platform/app`. */
export const APP_DIR = resolve(
  fileURLToPath(new URL("../../../../", import.meta.url)),
);
export const SRC_DIR = join(APP_DIR, "src");
export const EE_DIR = join(APP_DIR, "ee");

export const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js"];

/** Every source file under `directory`, tests and generated code excluded. */
export function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return ["__tests__", "__mocks__", "node_modules", "generated"].includes(
        entry.name,
      )
        ? []
        : sourceFiles(path);
    }
    if (entry.name.endsWith(".d.ts")) return [];
    if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) return [];
    return EXTENSIONS.some((extension) => entry.name.endsWith(extension))
      ? [path]
      : [];
  });
}

/**
 * Both trees the app ships from.
 *
 * `src` and `ee` together are the whole composition surface: nothing outside
 * them registers a scheduled job or serves a request.
 */
export function appSourceFiles(): string[] {
  return [...sourceFiles(SRC_DIR), ...sourceFiles(EE_DIR)];
}
