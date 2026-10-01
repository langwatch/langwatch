import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * ADR-115's boundaries as graph facts (modules/identity/specs/package-boundary.feature).
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
/** Every tree that ships application code; the identity module composes itself in its app. */
const APPLICATION_ROOTS = ["apps", "modules", "enterprise", "packages"];
/** The word boundary keeps `CryptoIdentifierIdentityService.create(` from matching. */
const CONSTRUCTS_IDENTITY_SERVICE = /(?:\bnew IdentityService\(|\bIdentityService\.create\()/;
const IDENTITY_SRC = join(REPO_ROOT, "modules", "identity", "contract", "src");
const IDENTITY_SERVER_SRC = join(REPO_ROOT, "modules", "identity", "process", "src");

const SKIPPED_DIRECTORIES = new Set(["__tests__", "node_modules", "dist"]);

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry)) walk(path);
        continue;
      }
      if (path.endsWith(".ts") && !path.endsWith(".test.ts")) files.push(path);
    }
  };
  walk(root);
  return files;
}

function importSpecifiers(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/gm)].map(
    (match) => match[1] as string,
  );
}

/**
 * The app and the storage engines, for every identity package.
 */
const FORBIDDEN_FOR_EVERY_IDENTITY_PACKAGE = [
  /^~\//,
  /^@prisma\//,
  /^\.prisma\//,
  /prisma\/client/,
];

/** …plus the framework, for the pure core, which must stay isomorphic. */
const FORBIDDEN_FRAMEWORK = [/event-sourcing/, /^@langwatch\/eventing(?:\/|$)/];

const FORBIDDEN_FOR_CONTRACT = [...FORBIDDEN_FOR_EVERY_IDENTITY_PACKAGE, ...FORBIDDEN_FRAMEWORK];

/** Every file that constructs an IdentityService, sorted; the class's own factory is not one. */
function identityServiceConstructors(): string[] {
  const constructors: string[] = [];
  for (const root of APPLICATION_ROOTS) {
    for (const file of sourceFiles(join(REPO_ROOT, root))) {
      const source = readFileSync(file, "utf8");
      if (/\bclass IdentityService\b/.test(source)) continue;
      if (CONSTRUCTS_IDENTITY_SERVICE.test(source)) {
        constructors.push(relative(REPO_ROOT, file).split(sep).join("/"));
      }
    }
  }
  return constructors.toSorted();
}

describe("identity package boundaries", () => {
  describe("when the pure core's sources are scanned", () => {
    /** @scenario "The pure identity core compiles without node types" */
    it("import no node built-in, Prisma, the app, or the event-sourcing framework", () => {
      const offenders: string[] = [];
      for (const file of sourceFiles(IDENTITY_SRC)) {
        for (const specifier of importSpecifiers(file)) {
          const forbidden =
            specifier.startsWith("node:") ||
            FORBIDDEN_FOR_CONTRACT.some((pattern) => pattern.test(specifier));
          if (forbidden) offenders.push(`${relative(REPO_ROOT, file)} -> ${specifier}`);
        }
      }
      expect(offenders).toEqual([]);
    });
  });

  describe("when the server runtime's sources are scanned", () => {
    /**
     * @scenario "The identity server runtime reads no storage engine and no environment"
     *
     * `@langwatch/eventing` is no longer forbidden here: the core-application
     * exit folded the separate event-sourcing package — the framework envelope,
     * commands, folds, process managers and the four pipeline definitions the
     * worker registers — into this package, since nothing outside it composed
     * the two separately. This package is the ONE identity package that owns
     * the event-sourcing framework directly now; the pure core above still
     * may not reach it.
     */
    it("import no Prisma and no app, and read no process.env", () => {
      const offenders: string[] = [];
      for (const file of sourceFiles(IDENTITY_SERVER_SRC)) {
        for (const specifier of importSpecifiers(file)) {
          if (FORBIDDEN_FOR_EVERY_IDENTITY_PACKAGE.some((pattern) => pattern.test(specifier))) {
            offenders.push(`${relative(REPO_ROOT, file)} -> ${specifier}`);
          }
        }
        if (/process\.env/.test(readFileSync(file, "utf8"))) {
          offenders.push(`${relative(REPO_ROOT, file)} reads process.env`);
        }
      }
      expect(offenders).toEqual([]);
    });
  });

  describe("when every process, module and package is scanned", () => {
    /** @scenario "Only the identity module's app composes an IdentityService" */
    it("construct IdentityService only in the identity module's app", () => {
      expect(identityServiceConstructors()).toEqual([
        "modules/identity/process/src/app/identity-migrations-composition.build.ts",
        "modules/identity/process/src/app/identity.app.ts",
      ]);
    });
  });
});
