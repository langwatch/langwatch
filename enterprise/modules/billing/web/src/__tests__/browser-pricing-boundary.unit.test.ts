import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SOURCE_ROOT = join(PACKAGE_ROOT, "src");

const SOURCE_EXTENSIONS = [".ts", ".tsx"];

function collectSourceFiles(directory: string): string[] {
  const collected: string[] = [];

  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") {
        continue;
      }

      collected.push(...collectSourceFiles(path));
      continue;
    }

    if (SOURCE_EXTENSIONS.some((extension) => entry.endsWith(extension))) {
      collected.push(path);
    }
  }

  return collected;
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const SPECIFIER_PATTERNS = [
  /\bfrom[ \t\r\n]*["']([^"']+)["']/g,
  /\bimport[ \t\r\n]*\([ \t\r\n]*["']([^"']+)["']/g,
  /\brequire[ \t\r\n]*\([ \t\r\n]*["']([^"']+)["']/g,
  /\bimport[ \t\r\n]+["']([^"']+)["']/g,
];

function importSpecifiersOf(source: string): string[] {
  const stripped = withoutComments(source);
  const specifiers: string[] = [];

  for (const pattern of SPECIFIER_PATTERNS) {
    for (const match of stripped.matchAll(pattern)) {
      const specifier = match[1];

      if (specifier) {
        specifiers.push(specifier);
      }
    }
  }

  return specifiers;
}

type PackageManifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

function isStripeSdk(specifier: string): boolean {
  return (
    specifier === "stripe" || specifier.startsWith("stripe/") || specifier.startsWith("@stripe/")
  );
}

function isPrismaClient(specifier: string): boolean {
  return (
    specifier === "@prisma/client" ||
    specifier === "@langwatch/prisma-client" ||
    specifier.includes("prisma/client") ||
    specifier.includes("generated/prisma")
  );
}

function isServerPackage(specifier: string): boolean {
  if (specifier.startsWith(".")) {
    return false;
  }

  const [scopeOrName, scoped] = specifier.split("/");
  const packageName = scopeOrName?.startsWith("@") ? `${scopeOrName}/${scoped ?? ""}` : scopeOrName;

  return (packageName ?? "").endsWith("-server") || (packageName ?? "").endsWith("/server");
}

function isApplicationSource(specifier: string): boolean {
  return (
    specifier === "@langwatch/ui" ||
    specifier.startsWith("@langwatch/ui/") ||
    specifier === "@langwatch/platform-api" ||
    specifier.startsWith("@langwatch/platform-api/") ||
    specifier === "@langwatch/worker" ||
    specifier.startsWith("@langwatch/worker/") ||
    specifier.startsWith("~/")
  );
}

const sourceFiles = collectSourceFiles(SOURCE_ROOT);

const graph = sourceFiles.map((path) => ({
  file: relative(PACKAGE_ROOT, path),
  specifiers: importSpecifiersOf(readFileSync(path, "utf8")),
}));

const allSpecifiers = graph.flatMap((entry) => entry.specifiers);

const manifest = JSON.parse(
  readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"),
) as PackageManifest;

const declaredPackages = [
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.devDependencies ?? {}),
  ...Object.keys(manifest.peerDependencies ?? {}),
];

describe("the Billing web package", () => {
  describe("given the modules that render and format pricing", () => {
    it("has a dependency graph to inspect", () => {
      expect(sourceFiles.length).toBeGreaterThan(10);
      expect(allSpecifiers).toContain("@langwatch/enterprise-billing-contract");
      expect(allSpecifiers).toContain("react");
    });

    describe("when its dependency graph is inspected", () => {
      /** @scenario "Keep browser pricing backend-free" */
      it("reaches no Stripe SDK, Prisma client, server package or application source", () => {
        const offenders = graph.flatMap((entry) =>
          entry.specifiers
            .filter(
              (specifier) =>
                isStripeSdk(specifier) ||
                isPrismaClient(specifier) ||
                isServerPackage(specifier) ||
                isApplicationSource(specifier),
            )
            .map((specifier) => `${entry.file} imports ${specifier}`),
        );

        expect(offenders).toEqual([]);
      });

      /** @scenario "Keep browser pricing backend-free" */
      it("declares no Stripe SDK, Prisma client or server package as a dependency", () => {
        const offenders = declaredPackages.filter(
          (name) => isStripeSdk(name) || isPrismaClient(name) || isServerPackage(name),
        );

        expect(offenders).toEqual([]);
      });

      /** @scenario "Keep browser pricing backend-free" */
      it("keeps every relative import inside the package", () => {
        const escapes = graph.flatMap((entry) =>
          entry.specifiers
            .filter((specifier) => specifier.startsWith("."))
            .filter((specifier) => {
              const from = join(PACKAGE_ROOT, entry.file, "..");
              const target = resolve(from, specifier);

              return !target.startsWith(SOURCE_ROOT + sep);
            })
            .map((specifier) => `${entry.file} imports ${specifier}`),
        );

        expect(escapes).toEqual([]);
      });
    });
  });
});
