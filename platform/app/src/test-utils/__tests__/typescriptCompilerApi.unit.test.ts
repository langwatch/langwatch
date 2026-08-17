/**
 * The compiler the repo builds against, and how its API may be reached.
 *
 * TypeScript 7's root export is a version constant: `import ts from
 * "typescript"` gives you `{ version }`, so `ts.createSourceFile(...)` is not a
 * type error at the call site of an untyped import — it is `undefined is not a
 * function` at runtime, in whatever ran the scan. The API lives behind
 * `typescript/unstable/*`, and this pins that nothing drifts back.
 *
 * The version sweep is here rather than in a lint rule because the exemptions
 * are the interesting part: two packages publish bundled `.d.ts` through a
 * toolchain that drives the old compiler API, so they are held on 6
 * deliberately and must not be swept forward by a well-meaning bulk bump.
 *
 * Spec: specs/setup/typescript-7.feature
 * ADR: dev/docs/adr/099-typescript-7-and-the-typecheck-memory-ceiling.md
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** platform/app/, from src/test-utils/__tests__/. */
const APP_ROOT = resolve(__dirname, "../../..");

/** The workspace root, which is two levels above the app. */
const REPO_ROOT = resolve(APP_ROOT, "../..");

/**
 * Packages held on TypeScript 6, each for the same reason: `tsup`'s `dts: true`
 * bundles declarations through the programmatic compiler API, which TypeScript
 * 7 does not expose. They move when a `.d.ts` bundler speaks the 7 API.
 */
const HELD_ON_SIX = new Set(["sdks/typescript", "mcp/typescript"]);

/** Where the workspace's own package manifests live, relative to the root. */
const MANIFEST_PATTERN =
  /^(package\.json|(platform|packages|plugins|sdks|mcp|skills)\/[^/]+\/package\.json|skills\/package\.json)$/;

const SOURCE_PATTERN = /\.(c|m)?[jt]sx?$/;

/**
 * A value import of the compiler's root export. `import type` is erased and
 * carries no runtime call, so it is not the failure this guards against.
 */
const ROOT_IMPORT_PATTERN =
  /^\s*import\s+(?!type\b)[^;]*?\bfrom\s+["']typescript["']|\brequire\(\s*["']typescript["']\s*\)/m;

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean);
}

const TRACKED = trackedFiles();

describe("given TypeScript 7 is the compiler", () => {
  describe("when source reaches for the compiler API", () => {
    // @scenario "The compiler API is only reached through its unstable export"
    it("finds no value import of the typescript root export", () => {
      const offenders = TRACKED.filter(
        (file) =>
          SOURCE_PATTERN.test(file) &&
          // The SDK and the MCP server are on TypeScript 6, where the root
          // export is still the compiler.
          ![...HELD_ON_SIX].some((held) => file.startsWith(`${held}/`)) &&
          ROOT_IMPORT_PATTERN.test(
            readFileSync(resolve(REPO_ROOT, file), "utf8"),
          ),
      );

      expect(offenders).toEqual([]);
    });
  });

  describe("when a workspace package declares its compiler", () => {
    const manifests = TRACKED.filter((file) => MANIFEST_PATTERN.test(file));

    // @scenario "Every workspace package builds against one compiler major"
    it("declares TypeScript 7 everywhere except the packages held on 6", () => {
      const declared = new Map<string, string>();
      for (const manifest of manifests) {
        const json = JSON.parse(
          readFileSync(resolve(REPO_ROOT, manifest), "utf8"),
        );
        const version =
          json.devDependencies?.typescript ?? json.dependencies?.typescript;
        if (version) declared.set(manifest, version);
      }

      // A package this test cannot see is a package it cannot enforce, so the
      // sweep failing to find the app at all is itself a failure.
      expect(declared.has("platform/app/package.json")).toBe(true);

      const wrong = [...declared].filter(([manifest, version]) => {
        const held = [...HELD_ON_SIX].some((pkg) =>
          manifest.startsWith(`${pkg}/`),
        );
        return held ? !version.startsWith("^6.") : !version.startsWith("^7.");
      });

      expect(wrong).toEqual([]);
    });

    // @scenario "The superseded preview compiler is gone"
    it("declares the native-preview package nowhere", () => {
      const offenders = manifests.filter((manifest) =>
        readFileSync(resolve(REPO_ROOT, manifest), "utf8").includes(
          "@typescript/native-preview",
        ),
      );

      expect(offenders).toEqual([]);
    });
  });
});
