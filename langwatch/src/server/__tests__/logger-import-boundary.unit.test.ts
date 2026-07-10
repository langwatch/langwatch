import { existsSync, readdirSync, readFileSync } from "fs";
import { join, relative, resolve } from "path";
import { describe, expect, it } from "vitest";

/**
 * `~/utils/logger` is browser-safe. `~/utils/logger/server` uses AsyncLocalStorage
 * and must never reach a client bundle. Files under `src/server/` therefore import
 * the server logger — except the handful that are value-imported by client code.
 *
 * `biome.json` enforces this via `noRestrictedImports`, but that guard only runs
 * when Biome's CLI version matches the config schema, and a stale exemption for a
 * deleted file rots silently. This test enforces the same invariant from the
 * filesystem, and treats `biome.json` as the single source of truth for exemptions
 * so the two cannot drift.
 */

const LANGWATCH_ROOT = resolve(__dirname, "../../..");
const SERVER_DIR = join(LANGWATCH_ROOT, "src/server");
const SERVER_OVERRIDE_GLOB = "src/server/**/*.ts";

/** Matches a specifier ending exactly at `utils/logger` — `utils/logger/server` does not match. */
const BROWSER_LOGGER_IMPORT = /from\s+["'][^"']*utils\/logger["']/;

function readBiomeOverrides(): { includes?: string[] }[] {
  const biome = JSON.parse(
    readFileSync(join(LANGWATCH_ROOT, "biome.json"), "utf-8"),
  ) as { overrides?: { includes?: string[] }[] };
  return biome.overrides ?? [];
}

/** The `!`-negated entries on the `src/server/**` override are the exempted files. */
function exemptedPathsFromBiomeConfig(): string[] {
  const serverOverride = readBiomeOverrides().find((override) =>
    override.includes?.includes(SERVER_OVERRIDE_GLOB),
  );
  if (!serverOverride) {
    throw new Error(
      `no biome override found covering ${SERVER_OVERRIDE_GLOB} — the logger guard is gone`,
    );
  }
  return (serverOverride.includes ?? [])
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
  const exempted = exemptedPathsFromBiomeConfig();

  describe("when scanning every source file under src/server", () => {
    it("finds the browser-safe logger imported only by exempted files", () => {
      expect(filesImportingBrowserLogger()).toEqual([...exempted].sort());
    });
  });

  describe("when checking the exemptions declared in biome.json", () => {
    it("points every exemption at a file that still exists", () => {
      const missing = exempted.filter(
        (path) => !existsSync(join(LANGWATCH_ROOT, path)),
      );
      expect(missing).toEqual([]);
    });

    it("keeps every exempted file on the browser-safe logger", () => {
      const unnecessary = exempted.filter(
        (path) =>
          !BROWSER_LOGGER_IMPORT.test(
            readFileSync(join(LANGWATCH_ROOT, path), "utf-8"),
          ),
      );
      expect(unnecessary).toEqual([]);
    });
  });
});
