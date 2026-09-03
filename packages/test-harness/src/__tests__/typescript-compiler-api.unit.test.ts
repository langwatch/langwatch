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
 * are the interesting part: three packages drive the old programmatic compiler
 * API, so they are held on 6 deliberately and must not be swept forward by a
 * well-meaning bulk bump. The exemption is what the root-import scan reads too
 * — on 6 the root export IS the compiler, so a value import of it there is the
 * supported way to reach the API rather than the runtime failure it is on 7.
 *
 * Spec: specs/setup/typescript-7.feature
 * ADR: dev/docs/adr/099-typescript-7-is-the-compiler.md
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
 * Packages held on TypeScript 6, for two reasons rather than one.
 *
 * `sdks/typescript` and `mcp/typescript` publish bundled `.d.ts` through
 * `tsup`'s `dts: true`, which drives the programmatic compiler API that
 * TypeScript 7 does not expose. They move when a `.d.ts` bundler speaks the
 * 7 API.
 *
 * `packages/architecture-lint` drives that API directly, and far more of it:
 * 19 rule modules and ~726 call sites, including `createProgram`,
 * `createPrinter`, `createScanner`, `preProcessFile`, `parseJsonText`,
 * `readConfigFile` and `sys`, none of which `typescript/unstable/*` offers.
 * It is also the wrong shape for the ADR-099 seam: the seam parses through a
 * `tsgo` child, which is a round trip per file, and this is a synchronous CLI
 * walking 8,700 modules on every `pnpm lint`. Parsing in process against 6,
 * with a cache keyed on path + mtime + size, is the deliberate call recorded
 * in `dev/docs/plans/core-application-feature-extraction-plan.md`. It moves
 * when the unstable API grows a program, a printer and a scanner, or when the
 * rules are restructured to parse the whole tree in one exchange.
 */
const HELD_ON_SIX = new Set(["sdks/typescript", "mcp/typescript", "packages/architecture-lint"]);

/**
 * Where the workspace's own package manifests live, relative to the root.
 *
 * `packages/` is walked at any depth: a feature package's manifest is three
 * levels down (`packages/features/<feature>/<surface>/package.json`), so a
 * single-segment alternation saw the flat packages and none of the 149 feature
 * and enterprise ones. `apps/` replaced the `platform/` alternation when the
 * monolith was deleted; without it the three applications were unscanned and
 * the canary below had nothing left to find. `sdks/` stays single-segment on
 * purpose — its `examples/` are standalone sample projects, not workspace
 * packages this repo builds.
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
    // @scenario "The compiler API is only reached through its unstable export"
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

    // @scenario "Every workspace package builds against one compiler major"
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

    // @scenario "The superseded preview compiler is gone"
    it("declares the native-preview package nowhere", () => {
      const offenders = manifests.filter((manifest) =>
        readFileSync(resolve(REPO_ROOT, manifest), "utf8").includes("@typescript/native-preview"),
      );

      expect(offenders).toEqual([]);
    });
  });
});
