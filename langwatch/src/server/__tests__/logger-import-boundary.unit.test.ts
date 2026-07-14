import { readdirSync, readFileSync } from "fs";
import { join, relative, resolve } from "path";
import { describe, expect, it } from "vitest";

/**
 * `~/utils/logger` is browser-safe. `~/utils/logger/server` pulls in
 * `node:async_hooks` (AsyncLocalStorage) and must never reach a client bundle.
 * Files under `src/server/` therefore import the server logger — except those
 * that client code value-imports.
 *
 * `biome.json` states this as a `noRestrictedImports` rule, but lint cannot
 * check that an exemption still points at a file that exists, and the pinned
 * Biome CLI currently rejects its own config (schema 2.4.14 vs CLI 2.5.1), so
 * `pnpm lint` never evaluates the rule locally. This test enforces the boundary
 * from the filesystem instead, independent of any Biome version.
 *
 * EXEMPTED is deliberately hardcoded rather than read out of `biome.json`.
 * A guard that derives its expectations from the config it guards can never
 * disagree with that config: adding a browser-logger import AND a matching
 * exemption would satisfy both. Stating the list here forces widening the
 * boundary to be an explicit, reviewable edit to this file.
 */

const LANGWATCH_ROOT = resolve(__dirname, "../../..");
const SERVER_DIR = join(LANGWATCH_ROOT, "src/server");
const LOGGER_PATTERN_GROUP = "**/utils/logger";

/**
 * Client-reachable files that must stay on the browser-safe logger.
 * `src/server/evaluations/preconditions.ts` is value-imported by the client
 * component `src/components/checks/TryItOut.tsx`.
 */
const EXEMPTED = ["src/server/evaluations/preconditions.ts"];

/**
 * Matches a specifier ending exactly at `utils/logger`, in `import ... from`,
 * `export ... from`, bare `import "..."`, and dynamic `import("...")` forms.
 * `utils/logger/server` does not match, and neither does `some-utils/logger`.
 */
const BROWSER_LOGGER_IMPORT =
  /(?:from|import)\s*\(?\s*["'](?:[^"']*\/)?utils\/logger["']/;

interface BiomeOverride {
  includes?: string[];
  linter?: {
    rules?: {
      style?: {
        noRestrictedImports?: {
          options?: { patterns?: { group?: string[] }[] };
        };
      };
    };
  };
}

function readServerOverride(): BiomeOverride | undefined {
  const biome = JSON.parse(
    readFileSync(join(LANGWATCH_ROOT, "biome.json"), "utf-8"),
  ) as { overrides?: BiomeOverride[] };
  return biome.overrides?.find((override) =>
    override.includes?.some((pattern) => pattern.startsWith("src/server/")),
  );
}

function exemptionsDeclaredInBiomeConfig(): string[] {
  const includes = readServerOverride()?.includes ?? [];
  return includes
    .filter((pattern) => pattern.startsWith("!"))
    .map((pattern) => pattern.slice(1));
}

function serverSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return serverSourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function filesImportingBrowserLogger(): string[] {
  return serverSourceFiles(SERVER_DIR)
    .filter((file) => BROWSER_LOGGER_IMPORT.test(readFileSync(file, "utf-8")))
    .map((file) => relative(LANGWATCH_ROOT, file))
    .sort();
}

describe("given the server logger import boundary", () => {
  describe("when scanning every source file under src/server", () => {
    it("finds the browser-safe logger imported only by the exempted files", () => {
      expect(filesImportingBrowserLogger()).toEqual([...EXEMPTED].sort());
    });
  });

  describe("when reading the guard declared in biome.json", () => {
    it("exempts exactly the files this test exempts", () => {
      expect(exemptionsDeclaredInBiomeConfig().sort()).toEqual(
        [...EXEMPTED].sort(),
      );
    });

    it("still bans the browser-safe logger under src/server", () => {
      const patterns =
        readServerOverride()?.linter?.rules?.style?.noRestrictedImports?.options
          ?.patterns ?? [];
      const groups = patterns.flatMap((pattern) => pattern.group ?? []);
      expect(groups).toContain(LOGGER_PATTERN_GROUP);
    });
  });
});
