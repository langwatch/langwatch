/**
 * ClickHouse client access has exactly two doors: the composition root
 * builds the resolvers (presets.ts), and everything else receives them
 * through the App or an injected repository. This suite walks the source
 * tree and fails on any module outside the allowlist that VALUE-imports the
 * client module — a type import is erased and is always fine.
 *
 * The allowlist is the whole policy. Adding a file to it is a design
 * decision, not a fix.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = join(__dirname, "..", "..", "..", "..");
const SCAN_ROOTS = [join(APP_ROOT, "src"), join(APP_ROOT, "ee")];

/**
 * The sanctioned value-importers, app-relative. presets.ts is the
 * composition root; system-migrations/runtime.ts is app-layer composition
 * for the migration runner; clickhouseMigrate.ts is the boot task that
 * hands each configured URL to goose; everything under server/clickhouse is
 * the module itself.
 */
const ALLOWED_IMPORTERS = new Set([
  "src/server/app-layer/presets.ts",
  "src/server/app-layer/system-migrations/runtime.ts",
  "src/tasks/clickhouseMigrate.ts",
]);

// The `./` sibling form is not matched: it only occurs inside the module
// itself, which the scan skips wholesale.
const CLIENT_MODULE_SPECIFIERS =
  /from\s+"(?:~\/server\/clickhouse|(?:\.\.\/)+clickhouse)\/(clickhouseClient|client)"/;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(entry.name)) yield full;
  }
}

/** Every import statement in the file that names the client module and
 *  carries at least one VALUE specifier (not `import type`, and not a
 *  specifier itself prefixed with `type `). */
function valueImportsOfClientModule(source: string): string[] {
  const statements = source.match(/import[\s\S]*?from\s+"[^"]+";/g) ?? ([] as string[]);
  return statements.filter((statement) => {
    if (!CLIENT_MODULE_SPECIFIERS.test(statement)) return false;
    if (/^import\s+type\b/.test(statement)) return false;
    const braced = /\{([\s\S]*?)\}/.exec(statement)?.[1];
    if (!braced) return true;
    return braced
      .split(",")
      .map((specifier) => specifier.trim())
      .filter(Boolean)
      .some((specifier) => !specifier.startsWith("type "));
  });
}

describe("given the two-door ClickHouse access policy", () => {
  describe("when the source tree is scanned for value-imports of the client module", () => {
    /** @scenario The application reaches ClickHouse through the composition root alone */
    it("finds them only in the composition root and the sanctioned boot paths", () => {
      const offenders: string[] = [];
      for (const root of SCAN_ROOTS) {
        for (const file of walk(root)) {
          const appRelative = relative(APP_ROOT, file);
          if (appRelative.startsWith(join("src", "server", "clickhouse"))) continue;
          if (/\.test\.tsx?$/.test(appRelative)) continue;
          if (appRelative.includes("__tests__")) continue;
          if (appRelative.startsWith(join("src", "test-utils"))) continue;
          if (ALLOWED_IMPORTERS.has(appRelative.split("\\").join("/"))) continue;
          const source = readFileSync(file, "utf8");
          if (valueImportsOfClientModule(source).length > 0) {
            offenders.push(appRelative);
          }
        }
      }
      expect(offenders).toEqual([]);
    });
  });
});
