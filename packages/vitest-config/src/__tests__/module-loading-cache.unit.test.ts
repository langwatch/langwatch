import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import type {
  LoadFnOutput,
  LoadHookContext,
  ResolveFnOutput,
  ResolveHookContext,
} from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { moduleLoadingCacheExecArgv } from "../module-loading-cache.ts";
import { CacheFile } from "../module-loading-cache/cache-file.ts";
import { CacheTable } from "../module-loading-cache/cache-table.ts";
import { createModuleLoadingHooks } from "../module-loading-cache/module-loading-hooks.ts";
import { moduleVitestTestOptions } from "../vitest-config.ts";

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

    /** @scenario "A worker answers a package lookup it has seen before from the cache" */
    it("keeps answers apart by conditions", () => {
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

    /** @scenario "A lookup that lands in project source is left to Node" */
    it("asks Node every time for a project subpath import, which the project's manifest decides", () => {
      const { packageUrl, projectUrl } = workspace();
      const { resolve, resolutions } = hooksOver();
      const nextResolve = vi.fn((): ResolveFnOutput => ({ url: packageUrl, format: "commonjs" }));

      resolve("#pad", { ...resolveContext, parentURL: projectUrl }, nextResolve);

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

    /** @scenario "A changed installed file is read again, never served stale" */
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

    /** @scenario "A worker reads an unchanged installed file from the cache" */
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

describe("CacheFile", () => {
  /** @scenario "An install starts a fresh cache" */
  it("starts empty under a new salt and removes the old file on save", () => {
    const dir = mkdtempSync(join(tmpdir(), "module-loading-cache-file-"));
    const before = new CacheFile({ dir, name: "sources", salt: "lockfile:1" });
    before.set("a", Buffer.from("1"));
    before.save();

    const after = new CacheFile({ dir, name: "sources", salt: "lockfile:2" });
    after.set("b", Buffer.from("2"));
    after.save();

    expect(after.get("a")).toBeUndefined();
    expect(readdirSync(dir)).toEqual([after.path.slice(dir.length + 1)]);
  });

  /** @scenario "An install starts a fresh cache" */
  it("removes a temporary file a killed worker left behind, once it is an hour old", () => {
    const dir = mkdtempSync(join(tmpdir(), "module-loading-cache-file-"));
    const cache = new CacheFile({ dir, name: "sources", salt: "s" });
    const abandoned = `${cache.path}.123.tmp`;
    const inFlight = `${cache.path}.456.tmp`;
    writeFileSync(abandoned, "");
    writeFileSync(inFlight, "");
    const twoHoursAgo = new Date(statSync(dir).mtimeMs - 2 * 60 * 60 * 1000);
    utimesSync(abandoned, twoHoursAgo, twoHoursAgo);

    cache.set("a", Buffer.from("1"));
    cache.save();

    expect(readdirSync(dir).toSorted()).toEqual(
      [cache.path, inFlight].map((path) => path.slice(dir.length + 1)).toSorted(),
    );
  });

  /** @scenario "Workers that save at once keep each other's entries" */
  it("merges what another worker saved since this one opened the file", () => {
    const dir = mkdtempSync(join(tmpdir(), "module-loading-cache-file-"));
    const first = new CacheFile({ dir, name: "resolutions", salt: "s" });
    const second = new CacheFile({ dir, name: "resolutions", salt: "s" });
    first.set("a", Buffer.from("1"));
    second.set("b", Buffer.from("2"));

    first.save();
    second.save();
    const reopened = new CacheFile({ dir, name: "resolutions", salt: "s" });

    expect(reopened.get("a")?.toString()).toBe("1");
    expect(reopened.get("b")?.toString()).toBe("2");
    expect(reopened.size).toBe(2);
  });
});

describe("CacheTable", () => {
  it("reads back every entry it was built from, and misses the rest", () => {
    const entries = new Map<string, Buffer>();
    for (let i = 0; i < 2_000; i++)
      entries.set(`file:///p/node_modules/m${i}/\0./x${i}`, Buffer.from(`v${i}`));
    entries.set("file:///ünïcode/\0x", Buffer.from("ü"));

    const table = new CacheTable(CacheTable.build(entries));

    for (const [key, value] of entries) expect(table.get(key)).toEqual(value);
    expect(table.get("missing")).toBeUndefined();
    expect(new Map(table.entries()).size).toBe(entries.size);
  });

  /** @scenario "A damaged cache file reads as empty" */
  it("reads a file cut short, or not a cache file, as empty", () => {
    const built = CacheTable.build(new Map([["key", Buffer.from("value")]]));

    expect(new CacheTable(built.subarray(0, built.length - 1)).get("key")).toBeUndefined();
    expect(new CacheTable(Buffer.from("not a cache file at all")).get("key")).toBeUndefined();
    expect(new CacheTable(undefined).size).toBe(0);
  });
});

describe("moduleLoadingCacheExecArgv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** @scenario "The cache is on for local runs and off in CI unless asked" */
  it("imports the worker hooks on a local run", () => {
    vi.stubEnv("CI", "");
    vi.stubEnv("LANGWATCH_VITEST_MODULE_CACHE", undefined);

    expect(moduleLoadingCacheExecArgv()).toEqual([
      "--import",
      expect.stringMatching(/module-loading-cache\/register\.ts$/),
    ]);
  });

  /** @scenario "The cache is on for local runs and off in CI unless asked" */
  it("adds nothing in CI", () => {
    vi.stubEnv("CI", "true");
    vi.stubEnv("LANGWATCH_VITEST_MODULE_CACHE", undefined);

    expect(moduleLoadingCacheExecArgv()).toEqual([]);
  });

  /** @scenario "The cache is on for local runs and off in CI unless asked" */
  it("lets LANGWATCH_VITEST_MODULE_CACHE outrank both", () => {
    vi.stubEnv("CI", "true");
    vi.stubEnv("LANGWATCH_VITEST_MODULE_CACHE", "1");
    expect(moduleLoadingCacheExecArgv()).toHaveLength(2);

    vi.stubEnv("CI", "");
    vi.stubEnv("LANGWATCH_VITEST_MODULE_CACHE", "0");
    expect(moduleLoadingCacheExecArgv()).toEqual([]);
  });

  /** @scenario "Fast mode off leaves the workers as they were" */
  it("gives the workers no extra Node options when fast mode is off", () => {
    vi.stubEnv("CI", "");
    vi.stubEnv("LANGWATCH_VITEST_FAST", "0");

    expect(moduleVitestTestOptions({ kind: "node" })).not.toHaveProperty("execArgv");
  });
});
