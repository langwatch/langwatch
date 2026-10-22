import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import type {
  LoadFnOutput,
  LoadHookContext,
  ResolveFnOutput,
  ResolveHookContext,
} from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { createModuleLoadingHooks } from "../module-loading-cache/module-loading-hooks.ts";

const resolveContext: ResolveHookContext = {
  conditions: ["node", "import"],
  importAttributes: {},
  parentURL: undefined,
};
const loadContext: LoadHookContext = {
  conditions: ["node", "import"],
  format: undefined,
  importAttributes: {},
};

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "module-loading-cache-"));
  const packageFile = join(root, "node_modules", "left-pad", "index.js");
  mkdirSync(join(root, "node_modules", "left-pad"), { recursive: true });
  mkdirSync(join(root, "node_modules", ".vitest-cache"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(packageFile, "module.exports = 1;\n");
  return {
    root,
    packageFile,
    packageUrl: pathToFileURL(packageFile).href,
    projectUrl: pathToFileURL(join(root, "src", "app.ts")).href,
  };
}

function hooksOver() {
  const resolutions = new Map<string, Buffer>();
  const sources = new Map<string, Buffer>();
  return { resolutions, sources, ...createModuleLoadingHooks({ resolutions, sources }) };
}

function nextLoadFromDisk() {
  return vi.fn((url: string): LoadFnOutput => ({
    format: "commonjs",
    source: readFileSync(new URL(url), "utf8"),
  }));
}

describe("createModuleLoadingHooks", () => {
  describe("when resolving", () => {
    /** @scenario "A worker answers a package lookup it has seen before from the cache" */
    it("answers a package name it resolved into node_modules from the cache the second time", () => {
      const { packageUrl, projectUrl } = workspace();
      const { resolve } = hooksOver();
      const nextResolve = vi.fn((): ResolveFnOutput => ({ url: packageUrl, format: "commonjs" }));
      const context = { ...resolveContext, parentURL: projectUrl };

      const first = resolve("left-pad", context, nextResolve);
      const second = resolve("left-pad", context, nextResolve);

      expect(first.url).toBe(packageUrl);
      expect(second).toEqual({ url: packageUrl, format: "commonjs", shortCircuit: true });
      expect(nextResolve).toHaveBeenCalledTimes(1);
    });

    /** @scenario "A cached lookup is not shared across resolution conditions" */
    it("asks Node again when the same name is resolved under other conditions", () => {
      const { packageUrl, projectUrl } = workspace();
      const { resolve } = hooksOver();
      const nextResolve = vi.fn((): ResolveFnOutput => ({ url: packageUrl, format: "module" }));

      resolve("left-pad", { ...resolveContext, parentURL: projectUrl }, nextResolve);
      resolve(
        "left-pad",
        { ...resolveContext, conditions: ["node", "require"], parentURL: projectUrl },
        nextResolve,
      );

      expect(nextResolve).toHaveBeenCalledTimes(2);
    });

    /** @scenario "A lookup that lands in project source is left to Node" */
    it("asks Node every time for a specifier that lands in project source", () => {
      const { projectUrl } = workspace();
      const { resolve, resolutions } = hooksOver();
      const nextResolve = vi.fn((): ResolveFnOutput => ({ url: projectUrl, format: "module" }));
      const context = { ...resolveContext, parentURL: projectUrl };

      resolve("./app.ts", context, nextResolve);
      resolve("./app.ts", context, nextResolve);

      expect(nextResolve).toHaveBeenCalledTimes(2);
      expect(resolutions.size).toBe(0);
    });

    /** @scenario "A subpath import from project code is left to Node" */
    it("asks Node every time for a project subpath import, which the project's manifest decides", () => {
      const { packageUrl, projectUrl } = workspace();
      const { resolve, resolutions } = hooksOver();
      const nextResolve = vi.fn((): ResolveFnOutput => ({ url: packageUrl, format: "commonjs" }));
      const context = { ...resolveContext, parentURL: projectUrl };

      resolve("#pad", context, nextResolve);
      resolve("#pad", context, nextResolve);

      expect(nextResolve).toHaveBeenCalledTimes(2);
      expect(resolutions.size).toBe(0);
    });
  });

  describe("when loading", () => {
    /** @scenario "A worker reads an unchanged installed file from the cache" */
    it("serves an unchanged installed file from the cache the second time", () => {
      const { packageUrl } = workspace();
      const { load } = hooksOver();
      const nextLoad = nextLoadFromDisk();

      load(packageUrl, loadContext, nextLoad);
      const second = load(packageUrl, loadContext, nextLoad);

      expect(second).toEqual({
        format: "commonjs",
        source: "module.exports = 1;\n",
        shortCircuit: true,
      });
      expect(nextLoad).toHaveBeenCalledTimes(1);
    });

    /** @scenario "A changed installed file is read again, never served stale" */
    it("reads an edited file from disk even when its size is unchanged", () => {
      const { packageFile, packageUrl } = workspace();
      const { load, sources, counts } = hooksOver();
      const nextLoad = nextLoadFromDisk();
      load(packageUrl, loadContext, nextLoad);

      writeFileSync(packageFile, "module.exports = 2;\n");
      utimesSync(packageFile, new Date(), new Date(Date.now() + 5_000));
      const edited = load(packageUrl, loadContext, nextLoad);
      const again = load(packageUrl, loadContext, nextLoad);

      expect(edited.source).toBe("module.exports = 2;\n");
      expect(again.source).toBe("module.exports = 2;\n");
      expect(counts.loadStale).toBe(1);
      expect(sources.get(packageUrl)?.toString("utf8", 25)).toBe("module.exports = 2;\n");
    });

    /** @scenario "A deleted installed file is not served from the cache" */
    it("serves nothing for a file that has been deleted", () => {
      const { packageFile, packageUrl } = workspace();
      const { load } = hooksOver();
      load(packageUrl, loadContext, nextLoadFromDisk());
      const gone = new Error("ENOENT");
      rmSync(packageFile);

      expect(() =>
        load(packageUrl, loadContext, () => {
          throw gone;
        }),
      ).toThrow(gone);
    });

    /** @scenario "Generated files under node_modules are left to Node" */
    it("leaves files in dot directories under node_modules to Node", () => {
      const { root } = workspace();
      const generated = join(root, "node_modules", ".vitest-cache", "entry.js");
      writeFileSync(generated, "export {};\n");
      const { load, sources } = hooksOver();

      load(pathToFileURL(generated).href, loadContext, nextLoadFromDisk());

      expect(sources.size).toBe(0);
    });

    /** @scenario "A cached source is not served to a caller expecting another format" */
    it("asks Node when the caller expects another format than the one cached", () => {
      const { packageUrl } = workspace();
      const { load } = hooksOver();
      const nextLoad = nextLoadFromDisk();
      load(packageUrl, loadContext, nextLoad);

      load(packageUrl, { ...loadContext, format: "module" }, nextLoad);

      expect(nextLoad).toHaveBeenCalledTimes(2);
    });
  });
});
