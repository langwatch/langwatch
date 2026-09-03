/**
 * The browser entry, checked without building it.
 *
 * A Vite build takes minutes and needs the whole workspace installed; what
 * breaks the entry is smaller than that and always the same three things — the
 * HTML shell pointing at a module that is not there, the public directory not
 * being where Vite looks for it, and a path alias reaching back out of this
 * package. Each is one assertion here.
 */

import { existsSync, readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import type { ConfigEnv, UserConfig } from "vite";
import viteConfig from "../vite.config";
import { ROOT_DISCOVERY_PATHS, rootDiscoveryProxyPattern } from "../vite/root-discovery-proxy";

const packageRoot = path.resolve(import.meta.dirname, "..");
const indexHtml = readFileSync(path.join(packageRoot, "index.html"), "utf8");

const buildEnvironment: ConfigEnv = {
  command: "build",
  mode: "production",
  isSsrBuild: false,
  isPreview: false,
};

async function resolveConfig(): Promise<UserConfig> {
  return (await (viteConfig as (env: ConfigEnv) => Promise<UserConfig>)(
    buildEnvironment,
  )) satisfies UserConfig;
}

describe("given the browser entry of apps/ui", () => {
  describe("when the HTML shell names its entry module", () => {
    it("points at a module that exists in this package", () => {
      const entry = /<script[^>]*\stype="module"[^>]*\ssrc="([^"]+)"/.exec(indexHtml)?.[1];

      expect(entry).toBe("/src/ui.entrypoint.tsx");
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

    it("declares no path alias, so nothing resolves outside this package", async () => {
      const config = await resolveConfig();

      // `platform/app` aliased `~`, `@app` and `@ee` into its own source tree.
      // Carrying any of them here would let a browser module reach the old
      // application, which is the one import direction the migration forbids.
      expect(config.resolve?.alias).toBeUndefined();
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
