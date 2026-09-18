/**
 * TypeScript 7 API lives behind `typescript/unstable/*` (not root export).
 * Exemptions for packages on TS 6 tracked here. See ADR-099.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/** packages/test-harness/, from src/__tests__/. */
const PACKAGE_ROOT = resolve(__dirname, "../..");

/** The workspace root, which is two levels above the app. */
const REPO_ROOT = resolve(PACKAGE_ROOT, "../..");

/**
 * Packages on TypeScript 6: sdks/typescript, mcp/typescript (tsup `dts`),
 * architecture-enforcer (programmatic API, sync CLI).
 */
const HELD_ON_SIX = new Set([
  "sdks/typescript",
  "mcp/typescript",
  "packages/architecture-enforcer",
]);

/**
 * Manifest pattern: `packages/` at any depth (modules), `apps/` (replaced
 * platform/), `sdks/` single-segment (examples are sample projects).
 */
const MANIFEST_PATTERN =
  /^(package\.json|(apps|plugins|sdks|mcp|skills)\/[^/]+\/package\.json|packages\/(?:[^/]+\/)+package\.json|skills\/package\.json)$/;

const SOURCE_PATTERN = /\.(c|m)?[jt]sx?$/;

/**
 * A value import of the compiler's root export. `import type` is erased and
 * carries no runtime call, so it is not the failure this guards against.
 */
const ROOT_IMPORT_PATTERN =
  /^\s*import\s+(?!type\b)[^;]*?\bfrom\s+["']typescript["']|\brequire\(\s*["']typescript["']\s*\)/m;

function trackedFiles(): string[] {
  return (
    execFileSync("git", ["ls-files", "-z"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean)
      // The index lists a file a working tree may already have deleted — a
      // rename in flight is exactly that shape. Reading one would take the whole
      // sweep down with an ENOENT, which is a scanner fault rather than a
      // finding, so the listing is narrowed to what is actually on disk.
      .filter((file) => existsSync(resolve(REPO_ROOT, file)))
  );
}

const TRACKED = trackedFiles();

describe("given TypeScript 7 is the compiler", () => {
  describe("when source reaches for the compiler API", () => {
    /** @scenario "The compiler API is only reached through its unstable export" */
    it("finds no value import of the typescript root export", () => {
      const offenders = TRACKED.filter(
        (file) =>
          SOURCE_PATTERN.test(file) &&
          // The SDK and the MCP server are on TypeScript 6, where the root
          // export is still the compiler.
          ![...HELD_ON_SIX].some((held) => file.startsWith(`${held}/`)) &&
          ROOT_IMPORT_PATTERN.test(readFileSync(resolve(REPO_ROOT, file), "utf8")),
      );

      expect(offenders).toEqual([]);
    });
  });

  describe("when a workspace package declares its compiler", () => {
    const manifests = TRACKED.filter((file) => MANIFEST_PATTERN.test(file));

    /** @scenario "Every workspace package builds against one compiler major" */
    it("declares TypeScript 7 everywhere except the packages held on 6", () => {
      const declared = new Map<string, string>();
      for (const manifest of manifests) {
        const json = JSON.parse(readFileSync(resolve(REPO_ROOT, manifest), "utf8"));
        const version = json.devDependencies?.typescript ?? json.dependencies?.typescript;
        if (version) declared.set(manifest, version);
      }

      // A package this test cannot see is a package it cannot enforce, so the
      // sweep failing to find the applications at all is itself a failure.
      // Three manifests rather than one, because the monolith they replaced was
      // a single canary and losing it took the assertion with it.
      for (const application of [
        "apps/api/package.json",
        "apps/ui/package.json",
        "apps/worker/package.json",
      ]) {
        expect(declared.has(application), `${application} was not scanned`).toBe(true);
      }

      const wrong = [...declared].filter(([manifest, version]) => {
        const held = [...HELD_ON_SIX].some((pkg) => manifest.startsWith(`${pkg}/`));
        return held ? !version.startsWith("^6.") : !version.startsWith("^7.");
      });

      expect(wrong).toEqual([]);
    });

    /** @scenario "The superseded preview compiler is gone" */
    it("declares the native-preview package nowhere", () => {
      const offenders = manifests.filter((manifest) =>
        readFileSync(resolve(REPO_ROOT, manifest), "utf8").includes("@typescript/native-preview"),
      );

      expect(offenders).toEqual([]);
    });
  });
});
