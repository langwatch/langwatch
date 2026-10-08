/**
 * The Vite config, loaded the way `vite` itself loads it.
 */

import { readFileSync } from "fs";
import { createServer } from "http";
import type { AddressInfo } from "net";
import path from "path";

import {
  PUBLIC_APP_CONFIG_META_NAME,
  createPublicAppConfigMetaTag,
  parsePublicAppConfigMetaContent,
} from "@langwatch/config/public-app-config";
import { loadConfigFromFile } from "vite";
import { describe, expect, it } from "vitest";

const apiConfig = {
  process: {
    appBaseUrl: "http://localhost:5560",
    mode: "development",
    deployment: "self-hosted",
    nlp: false,
  },
};

/** An api rendering the shell the dev server lifts its config from, while `run` runs. */
async function withStubApi<T>(run: () => Promise<T>): Promise<T> {
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(`<html><head>${createPublicAppConfigMetaTag(apiConfig)}</head></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await withoutEnv("LANGWATCH_PORTLESS", () =>
      withEnv("LANGWATCH_API_URL", `http://127.0.0.1:${port}`, run),
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const packageRoot = path.resolve(import.meta.dirname, "../..");
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
      const loaded = await withStubApi(() =>
        withEnv("BASE_HOST", "http://localhost:5560", () =>
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
        ),
      );

      expect(loaded?.config).toBeDefined();
    });
  });

  describe("when the api renders the page's public config", () => {
    /** @scenario "The dev server injects the api's public config" */
    it("injects the api's config into the dev shell", async () => {
      await withStubApi(() =>
        withoutEnv("BASE_HOST", async () => {
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
          const html = await transformIndexHtmlOf(inject)(
            "<html><head></head><body></body></html>",
          );
          const content = new RegExp(
            `name="${PUBLIC_APP_CONFIG_META_NAME}" content="([^"]+)"`,
          ).exec(html)?.[1];
          expect(content).toBeDefined();
          expect(parsePublicAppConfigMetaContent(content!).process?.appBaseUrl).toBe(
            "http://localhost:5560",
          );
        }),
      );
    });
  });
});

/** A plugin's `transformIndexHtml`, when it is declared as a plain function hook. */
function transformIndexHtmlOf(plugin: unknown): (html: string) => Promise<string> {
  if (typeof plugin !== "object" || plugin === null || !("transformIndexHtml" in plugin)) {
    throw new Error("the plugin declares no transformIndexHtml hook");
  }
  const hook: unknown = plugin.transformIndexHtml;
  if (typeof hook !== "function") throw new Error("transformIndexHtml is not a function hook");
  return async (html) => {
    const transformed: unknown = await Reflect.apply(hook, plugin, [html]);
    if (typeof transformed !== "string") throw new Error("transformIndexHtml returned no HTML");
    return transformed;
  };
}
