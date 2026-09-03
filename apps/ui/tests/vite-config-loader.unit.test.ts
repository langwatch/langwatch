/**
 * The Vite config, loaded the way `vite` itself loads it.
 *
 * Vitest resolves `vite.config.ts` through its own transform, which hides the
 * failure that matters: Vite's default config loader bundles the file and
 * externalises every bare import, so Node loads `@langwatch/config` natively
 * and refuses its extensionless relative imports. The package scripts name
 * the runner loader for that reason, and this test loads the config through
 * the loader those scripts name.
 */

import { readFileSync } from "fs";
import path from "path";
import { loadConfigFromFile } from "vite";
import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(import.meta.dirname, "..");
const scripts = (
  JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  }
).scripts;

function configLoaderOf(script: string): "bundle" | "runner" | "native" {
  const flag = /--configLoader\s+(\S+)/.exec(script)?.[1];
  return (flag ?? "bundle") as "bundle" | "runner" | "native";
}

describe("given the apps/ui Vite config", () => {
  describe("when Vite loads it with the loader the package scripts name", () => {
    /** @scenario "The Vite config loads the way the dev and build scripts load it" */
    it("resolves without a module resolution error", async () => {
      const loader = configLoaderOf(scripts.dev);
      expect(configLoaderOf(scripts.build)).toBe(loader);
      process.env.BASE_HOST ??= "http://localhost:5560";
      process.env.NODE_ENV ??= "development";

      const loaded = await loadConfigFromFile(
        { command: "serve", mode: "development" },
        "vite.config.ts",
        packageRoot,
        undefined,
        undefined,
        loader,
      );

      expect(loaded?.config).toBeDefined();
    });
  });
});
