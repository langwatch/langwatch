import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The package is pure (ADR-102): it imports no application code, and reaches
 * infrastructure only through ports declared inside it.
 *
 * A boundary stated in a docblock erodes — the first `~/server/...` import that
 * compiles is the one that ends the property, and nothing complains. This test
 * is the boundary. It reads the source rather than trusting the module graph,
 * so an import that is type-only, side-effect-only or dynamic is caught the
 * same as any other.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)));

/** The manifest, read at test time — see {@link DECLARED_DEPENDENCIES}. */
const PACKAGE_JSON = JSON.parse(
  readFileSync(join(SRC, "..", "package.json"), "utf8"),
) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

/**
 * The allowlist is the manifest, read at test time rather than restated here.
 * A hardcoded copy is a second source of truth, and the failure mode is the
 * quiet one: someone adds a dependency, the list is not updated, and the guard
 * reports a violation for an import that is entirely legitimate — so the guard
 * gets relaxed instead of the boundary being defended.
 */
const DECLARED_DEPENDENCIES: readonly string[] = [
  ...Object.keys(PACKAGE_JSON.dependencies ?? {}),
  ...Object.keys(PACKAGE_JSON.peerDependencies ?? {}),
];

/** Node builtins are permitted in test files only — in library code a builtin
 * is usually a hidden platform assumption. */
const ALLOWED_BARE_IMPORTS_IN_TESTS: readonly string[] = [
  "vitest",
  "node:fs",
  "node:path",
  "node:url",
];

/** A subpath import (`@langwatch/observability/context`) resolves against the
 * package that declares it, so compare on the package name. */
function packageNameOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith(".ts") ? [full] : [];
  });
}

/**
 * Every module specifier in the file: static `import`/`export ... from`, and
 * dynamic `import(...)`. Dynamic form is included deliberately — a guard that
 * only parses static imports can be walked straight past with `await import()`.
 */
function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const staticForm =
    /(?:^|\n)\s*(?:import|export)\b[^;\n]*?from\s*["']([^"']+)["']/g;
  const sideEffect = /(?:^|\n)\s*import\s*["']([^"']+)["']/g;
  const dynamicForm = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const pattern of [staticForm, sideEffect, dynamicForm]) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      if (match[1] !== undefined) specifiers.push(match[1]);
    }
  }
  return specifiers;
}

const isRelative = (specifier: string) => specifier.startsWith(".");

describe("package purity", () => {
  const files = sourceFiles(SRC);

  it("has source files to check", () => {
    // Guards the guard: a broken walk would make every assertion below vacuous.
    expect(files.length).toBeGreaterThan(0);
  });

  describe("given the library source", () => {
    const libraryFiles = files.filter((f) => !f.endsWith(".test.ts"));

    /** @scenario the core does not reach into the application */
    it("imports nothing outside the package but its declared dependencies", () => {
      const violations: string[] = [];
      for (const file of libraryFiles) {
        for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
          if (isRelative(specifier)) continue;
          if (DECLARED_DEPENDENCIES.includes(packageNameOf(specifier)))
            continue;
          violations.push(`${file.slice(SRC.length + 1)} -> ${specifier}`);
        }
      }
      expect(violations).toEqual([]);
    });

    /** @scenario the check covers imports that do not look like imports */
    it("reaches no application module through a path alias", () => {
      const violations: string[] = [];
      for (const file of libraryFiles) {
        for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
          if (
            specifier.startsWith("~/") ||
            specifier.includes("/langwatch/src/")
          ) {
            violations.push(`${file.slice(SRC.length + 1)} -> ${specifier}`);
          }
        }
      }
      expect(violations).toEqual([]);
    });
  });

  describe("given the test source", () => {
    const testFiles = files.filter((f) => f.endsWith(".test.ts"));

    /** @scenario the check follows what the package says it depends on */
    it("imports only the test runner, node builtins and package-local modules", () => {
      const violations: string[] = [];
      for (const file of testFiles) {
        for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
          if (isRelative(specifier)) continue;
          if (ALLOWED_BARE_IMPORTS_IN_TESTS.includes(specifier)) continue;
          if (DECLARED_DEPENDENCIES.includes(packageNameOf(specifier)))
            continue;
          violations.push(`${file.slice(SRC.length + 1)} -> ${specifier}`);
        }
      }
      expect(violations).toEqual([]);
    });
  });
});
