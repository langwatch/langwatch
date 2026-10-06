/**
 * Group Queue sits below Eventing and every application: its source never
 * names them, and consumers reach it only through its declared subpaths.
 * @vitest-environment node
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPO_ROOT = path.resolve(PACKAGE_ROOT, "..", "..");

function productionSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : productionSources(entryPath);
    return /\.tsx?$/.test(entry.name) && !entry.name.includes(".test.") ? [entryPath] : [];
  });
}

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map(
    (match) => match[1] ?? "",
  );
}

function applicationPackageNames(): string[] {
  const appsRoot = path.join(REPO_ROOT, "apps");
  return readdirSync(appsRoot)
    .map((name) => path.join(appsRoot, name, "package.json"))
    .filter((manifest) => existsSync(manifest))
    .map((manifest) => (JSON.parse(readFileSync(manifest, "utf8")) as { name: string }).name);
}

describe("the @langwatch/group-queue package boundary", () => {
  const manifest = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    exports: Record<string, unknown>;
  };
  const forbidden = (specifier: string) =>
    specifier === "@langwatch/eventing" ||
    specifier.startsWith("@langwatch/eventing/") ||
    specifier.startsWith("@langwatch/enterprise") ||
    applicationPackageNames().some((app) => specifier === app || specifier.startsWith(`${app}/`));

  /** @scenario Group Queue has no Eventing or application dependency */
  it("imports nothing from Eventing, an application or enterprise code", () => {
    const files = productionSources(path.join(PACKAGE_ROOT, "src"));
    expect(files.length).toBeGreaterThan(0);

    const offences = files.flatMap((file) =>
      importSpecifiers(readFileSync(file, "utf8"))
        .filter(forbidden)
        .map((specifier) => `${path.relative(PACKAGE_ROOT, file)} imports ${specifier}`),
    );

    expect(offences).toEqual([]);
    expect(Object.keys(manifest.dependencies ?? {}).filter(forbidden)).toEqual([]);
  });

  /** @scenario Group Queue has no Eventing or application dependency */
  it("exports only its declared public subpaths to consumers", () => {
    expect(Object.keys(manifest.exports).toSorted()).toEqual([".", "./operational"]);
  });
});
