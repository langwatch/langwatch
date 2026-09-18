/**
 * The browser entry, checked without building it.
 */

import { existsSync, readFileSync } from "fs";
import path from "path";

import type { ConfigEnv, UserConfig } from "vite";
import { describe, expect, it } from "vitest";

import viteConfig from "../../vite.config";
import { ROOT_DISCOVERY_PATHS, rootDiscoveryProxyPattern } from "../root-discovery-proxy";

const packageRoot = path.resolve(import.meta.dirname, "../..");
const indexHtml = readFileSync(path.join(packageRoot, "index.html"), "utf8");

const buildEnvironment: ConfigEnv = {
  command: "build",
  mode: "production",
  isSsrBuild: false,
  isPreview: false,
};

async function resolveConfig(environment: ConfigEnv = buildEnvironment): Promise<UserConfig> {
  return (await (viteConfig as (env: ConfigEnv) => Promise<UserConfig>)(
    environment,
  )) satisfies UserConfig;
}

describe("given the browser entry of apps/ui", () => {
  describe("when the HTML shell names its entry module", () => {
    it("points at a module that exists in this package", () => {
      const entry = /<script[^>]*\stype="module"[^>]*\ssrc="([^"]+)"/.exec(indexHtml)?.[1];

      expect(entry).toBe("/src/main.tsx");
      expect(existsSync(path.join(packageRoot, entry!.slice(1)))).toBe(true);
    });

    it("mounts into the root element the runtime looks for", () => {
      expect(indexHtml).toContain('<div id="root"></div>');
    });
  });

  describe("when the shell references an asset at the site root", () => {
    it("serves every one of them out of this package's public directory", async () => {
      const config = await resolveConfig();
      // Left at Vite's default, which is `<root>/public`. A config that names
      // its own would have to be checked against that name instead.
      expect(config.publicDir).toBeUndefined();

      const referenced = [...indexHtml.matchAll(/(?:href|src)="\/([^/"][^"]*)"/g)]
        .map((match) => match[1]!)
        // The entry module is served from source, not from `public/`.
        .filter((asset) => !asset.startsWith("src/"));

      expect(referenced.length).toBeGreaterThan(0);
      for (const asset of referenced) {
        expect(existsSync(path.join(packageRoot, "public", asset))).toBe(true);
      }
    });
  });

  describe("when the build config is resolved", () => {
    it("emits the client bundle where the serving process expects it", async () => {
      const config = await resolveConfig();

      expect(config.build?.outDir).toBe("dist/client");
      expect(config.build?.sourcemap).toBe(true);
    });

    it("declares no path alias reaching outside this package", async () => {
      // `platform/app` aliased `~`, `@app` and `@ee` into its own source tree.
      // Carrying any of them here would let a browser module reach the old
      // application, which is the one import direction the migration forbids.
      // Asserted on where the entries POINT, not on how vite spells an empty
      // alias — that has been undefined, [], and a plugin on three days.
      for (const command of ["build", "serve"] as const) {
        const config = await resolveConfig({ ...buildEnvironment, command });
        const alias = config.resolve?.alias ?? [];
        const targets = Array.isArray(alias)
          ? alias.map((entry) => String(entry.replacement))
          : Object.values(alias).map(String);

        expect(targets.filter((target) => target.includes("platform/app"))).toEqual([]);
      }
    });
  });

  describe("when a root-level request is not the single-page application's", () => {
    it("proxies exactly the API's discovery locations to the API", async () => {
      const config = await resolveConfig();
      const pattern = rootDiscoveryProxyPattern();

      expect(Object.keys(config.server?.proxy ?? {})).toContain(pattern);

      const matches = new RegExp(pattern);
      for (const discoveryPath of ROOT_DISCOVERY_PATHS) {
        expect(matches.test(discoveryPath)).toBe(true);
        expect(matches.test(`${discoveryPath}/`)).toBe(true);
        expect(matches.test(`${discoveryPath}?format=json`)).toBe(true);
      }

      expect(matches.test("/llms.txt.map")).toBe(false);
      expect(matches.test("/.well-known/openapi/extra")).toBe(false);
      expect(matches.test("/mcp/authorize")).toBe(false);
    });
  });
});
