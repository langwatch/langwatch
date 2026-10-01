import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// specs/dependencies/vendored-ksuid.feature — the KSUID libraries vendored
// from github.com/langwatch/ksuid release from this repository.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const ksuidRoot = join(root, "packages", "ksuid");
const ksuidPythonRoot = join(root, "packages", "ksuid-python");

describe("vendored ksuid packages", () => {
  describe("when the package's modules are inspected", () => {
    /** @scenario "The TypeScript package declares no global types" */
    it("contains no global type declaration in any emitted module", () => {
      const sources = readdirSync(join(ksuidRoot, "src")).filter(
        // globals.d.ts is ambient: part of the package's own compilation,
        // never emitted to dist, so it cannot reach a consumer.
        (file) => file.endsWith(".ts") && !file.endsWith(".d.ts"),
      );
      expect(sources.length).toBeGreaterThan(0);
      for (const file of sources) {
        const content = readFileSync(join(ksuidRoot, "src", file), "utf8");
        expect(content, `${file} must not declare global types`).not.toContain("declare global");
      }
    });
  });

  describe("when the release configuration is read", () => {
    /** @scenario "Both KSUID packages are registered for release" */
    it("registers both packages and excludes them from the root component", () => {
      const config = JSON.parse(
        readFileSync(join(root, ".github", "release-please-config.json"), "utf8"),
      ) as {
        packages: Record<string, { component?: string; "exclude-paths"?: string[] }>;
      };
      const manifest = JSON.parse(
        readFileSync(join(root, ".github", ".release-please-manifest.json"), "utf8"),
      ) as Record<string, string>;

      expect(config.packages["packages/ksuid"]?.component).toBe("ksuid");
      expect(config.packages["packages/ksuid-python"]?.component).toBe("ksuid-python");
      expect(manifest["packages/ksuid"]).toBeDefined();
      expect(manifest["packages/ksuid-python"]).toBeDefined();

      const rootExcludes = config.packages["."]?.["exclude-paths"] ?? [];
      expect(rootExcludes).toContain("packages/ksuid");
      expect(rootExcludes).toContain("packages/ksuid-python");
    });
  });

  describe("when the Python build configuration is read", () => {
    /** @scenario "The Python wheel packages the ksuid module" */
    it("targets the directory the module actually lives in", () => {
      // The standalone repository's wheel target named a directory that did
      // not exist, so the built wheel shipped no code at all. The module is
      // langwatch_ksuid — namespaced to match the PyPI package name, since
      // other PyPI ksuid libraries also claim a bare `ksuid` module.
      const pyproject = readFileSync(join(ksuidPythonRoot, "pyproject.toml"), "utf8");
      expect(pyproject).toContain('packages = ["langwatch_ksuid"]');
      expect(existsSync(join(ksuidPythonRoot, "langwatch_ksuid", "__init__.py"))).toBe(true);
    });
  });
});
