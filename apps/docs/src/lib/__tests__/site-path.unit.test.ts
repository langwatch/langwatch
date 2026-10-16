import { describe, expect, it } from "vitest";

import { readBuildOptions, readPreviewOptions } from "../../paths.ts";
import { BASE_PATH, stripBasePath, withBasePath } from "../site-path.ts";

describe("withBasePath", () => {
  /** @scenario "Build the documentation under a base path" */
  it("prefixes root-absolute site paths", () => {
    expect(withBasePath({ basePath: "/docs", path: "/introduction" })).toBe("/docs/introduction");
    expect(withBasePath({ basePath: "/docs", path: "/" })).toBe("/docs/");
    expect(withBasePath({ basePath: "/docs", path: "/x?y=1#z" })).toBe("/docs/x?y=1#z");
  });

  it("leaves external, protocol-relative, fragment and relative addresses alone", () => {
    for (const path of ["https://app.langwatch.ai/x", "//cdn.example/x", "#top", "?q", "x", ""]) {
      expect(withBasePath({ basePath: "/docs", path })).toBe(path);
    }
  });

  it("changes nothing at the root", () => {
    expect(withBasePath({ basePath: "", path: "/introduction" })).toBe("/introduction");
  });
});

describe("stripBasePath", () => {
  it("maps a request under the base to its site path", () => {
    expect(stripBasePath({ pathname: "/docs/introduction", basePath: "/docs" })).toBe(
      "/introduction",
    );
    expect(stripBasePath({ pathname: "/docs", basePath: "/docs" })).toBe("/");
  });

  it("answers null for app paths beside the docs", () => {
    expect(stripBasePath({ pathname: "/api/health", basePath: "/docs" })).toBeNull();
    expect(stripBasePath({ pathname: "/docsearch", basePath: "/docs" })).toBeNull();
  });
});

describe("build options", () => {
  it("default to the production root", () => {
    expect(readBuildOptions({ args: [] }).basePath).toBe("");
    expect(BASE_PATH).toBe("");
  });

  it("default to automatic render workers with the render cache on", () => {
    expect(readBuildOptions({ args: [] })).toMatchObject({ renderCache: true });
    expect(readBuildOptions({ args: [] }).renderWorkers).toBeUndefined();
    expect(
      readBuildOptions({ args: ["--render-workers", "3", "--no-render-cache"] }),
    ).toMatchObject({ renderWorkers: 3, renderCache: false });
    expect(() => readBuildOptions({ args: ["--render-workers", "0"] })).toThrow(/expected number/);
  });

  it("accept a base path and drop a trailing slash", () => {
    expect(readBuildOptions({ args: ["--base-path", "/docs/"] }).basePath).toBe("/docs");
    expect(readPreviewOptions({ args: ["--base-path", "/docs"] }).basePath).toBe("/docs");
  });

  /** @scenario "Build the documentation under a base path" */
  it("refuse a base path that is not a clean path prefix", () => {
    for (const value of [
      "docs",
      "/docs?x",
      "https://x/docs",
      "/do cs",
      "//docs",
      "/docs/../",
      "/..",
      "/.",
      "/docs/./x",
      "/docs#x",
    ]) {
      expect(() => readBuildOptions({ args: ["--base-path", value] })).toThrow(/base path/);
      expect(() => readPreviewOptions({ args: ["--base-path", value] })).toThrow(/base path/);
    }
  });
});
