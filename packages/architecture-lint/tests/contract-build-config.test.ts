import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lintStrictContractBuildConfigs, type ClassifiedPackage } from "../src";

let root = "";

function contractPackage(feature: string, hasBuildScript = true): ClassifiedPackage {
  const featureRoot = join(root, "packages/features", feature);
  const contractRoot = join(featureRoot, "contract");
  return {
    name: `@langwatch/${feature}-contract`,
    root: contractRoot,
    manifestPath: join(contractRoot, "package.json"),
    manifest: hasBuildScript ? { scripts: { build: "tsc --build" } } : {},
    kind: "contract",
    feature,
    featureRoot,
    layoutVersion: 0,
    subjects: [],
    enterprise: false,
  };
}

function writeConfig(feature: string, config: Record<string, unknown>): void {
  const directory = join(root, "packages/features", feature, "contract");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "tsconfig.build.json"), JSON.stringify(config));
}

describe("strict contract declaration build configs", () => {
  afterEach(() => {
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
    root = "";
  });

  it("discovers a newly added strict feature rather than relying on a feature list", () => {
    root = mkdtempSync(join(tmpdir(), "contract-build-config-"));
    writeConfig("future-feature", {
      compilerOptions: { rootDir: "src" },
      include: ["src/**/*.ts"],
      exclude: ["tests"],
    });

    expect(
      lintStrictContractBuildConfigs(root, [contractPackage("future-feature")]),
    ).toEqual([]);
  });

  it("rejects a config that can include a package test root", () => {
    root = mkdtempSync(join(tmpdir(), "contract-build-config-"));
    writeConfig("api-key", {
      compilerOptions: {},
      include: ["**/*.ts"],
      exclude: [],
    });

    expect(
      lintStrictContractBuildConfigs(root, [contractPackage("api-key")]),
    ).toMatchObject([{ policy: "contract-build-config" }]);
  });

  it("requires the build config when a discovered strict contract has a build script", () => {
    root = mkdtempSync(join(tmpdir(), "contract-build-config-"));

    expect(
      lintStrictContractBuildConfigs(root, [contractPackage("new-contract")]),
    ).toMatchObject([{ policy: "contract-build-config" }]);
  });
});
