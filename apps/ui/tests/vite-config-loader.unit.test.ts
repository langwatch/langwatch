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
import {
  PUBLIC_APP_CONFIG_META_NAME,
  parsePublicAppConfigMetaContent,
} from "@langwatch/config/public-app-config";
import { loadConfigFromFile } from "vite";
import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(import.meta.dirname, "..");
const scripts = (
  JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  }
).scripts;

/** `scripts[name]` is a `noUncheckedIndexedAccess` lookup; the script must exist. */
function requiredScript(name: string): string {
  const script = scripts[name];
  if (script === undefined) {
    throw new Error(`apps/ui/package.json has no "${name}" script`);
  }
  return script;
}

function configLoaderOf(script: string): "bundle" | "runner" | "native" {
  const flag = /--configLoader\s+(\S+)/.exec(script)?.[1];
  return (flag ?? "bundle") as "bundle" | "runner" | "native";
}

/** Sets an env var for the duration of `run`, restoring (or deleting) it after. */
async function withEnv<T>(key: string, value: string, run: () => Promise<T>): Promise<T> {
  const previous = process.env[key];
  process.env[key] = value;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
}

/** Deletes an env var for the duration of `run`, restoring it after. */
async function withoutEnv<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = process.env[key];
  delete process.env[key];
  try {
    return await run();
  } finally {
    if (previous !== undefined) process.env[key] = previous;
  }
}

describe("given the apps/ui Vite config", () => {
  describe("when Vite loads it with the loader the package scripts name", () => {
    /** @scenario "The Vite config loads the way the dev and build scripts load it" */
    it("resolves without a module resolution error", async () => {
      const loader = configLoaderOf(requiredScript("dev"));
      expect(configLoaderOf(requiredScript("build"))).toBe(loader);

      // Set and restore our own env rather than `??=`: whatever the shell
      // already carries for BASE_HOST/NODE_ENV must not change the outcome.
      const loaded = await withEnv("BASE_HOST", "http://localhost:5560", () =>
        withEnv("NODE_ENV", "development", () =>
          loadConfigFromFile(
            { command: "serve", mode: "development" },
            "vite.config.ts",
            packageRoot,
            undefined,
            undefined,
            loader,
          ),
        ),
      );

      expect(loaded?.config).toBeDefined();
    });
  });

  describe("when no BASE_HOST is set for the dev server", () => {
    /** @scenario "The Vite config loads the way the dev and build scripts load it" */
    it("takes the dev server's own address instead of refusing to boot", async () => {
      await withoutEnv("BASE_HOST", async () => {
        const loaded = await loadConfigFromFile(
          { command: "serve", mode: "development" },
          "vite.config.ts",
          packageRoot,
          undefined,
          undefined,
          configLoaderOf(requiredScript("dev")),
        );
        const inject = loaded?.config.plugins
          ?.flat()
          .find(
            (plugin) =>
              plugin && "name" in plugin && plugin.name === "inject-development-public-config",
          );
        expect(inject).toBeDefined();
        const html = await (
          inject as { transformIndexHtml: (html: string) => string | Promise<string> }
        ).transformIndexHtml("<html><head></head><body></body></html>");
        const content = new RegExp(`name="${PUBLIC_APP_CONFIG_META_NAME}" content="([^"]+)"`).exec(
          html,
        )?.[1];
        expect(content).toBeDefined();
        expect(parsePublicAppConfigMetaContent(content!).appBaseUrl).toBe("http://localhost:5560");
      });
    });
  });
});
