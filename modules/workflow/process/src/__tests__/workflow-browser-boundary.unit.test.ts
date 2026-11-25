/**
 * Which code may import the Workflow browser surface, read off the tree.
 * @vitest-environment node
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const PROCESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPO_ROOT = path.resolve(PROCESS_ROOT, "..", "..", "..");
const BROWSER_PACKAGE = "@langwatch/workflow-browser";

function productionSources(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return ["__tests__", "node_modules", "dist"].includes(entry.name)
        ? []
        : productionSources(entryPath);
    }
    return /\.tsx?$/.test(entry.name) && !entry.name.includes(".test.") ? [entryPath] : [];
  });
}

function backendRoots(): string[] {
  const roots = ["modules", "enterprise/modules"].flatMap((group) => {
    const groupRoot = path.join(REPO_ROOT, group);
    if (!existsSync(groupRoot)) return [];
    return readdirSync(groupRoot).flatMap((name) => [
      path.join(groupRoot, name, "process"),
      path.join(groupRoot, name, "contract"),
    ]);
  });
  const apps = ["api", "worker", "tasks"].map((name) => path.join(REPO_ROOT, "apps", name));

  return [...roots, ...apps].filter((root) => existsSync(root));
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map(
    (match) => match[1] ?? "",
  );
}

describe("the Workflow browser surface", () => {
  /** @scenario "Local configuration dispatch stays portable" */
  it("is imported by no backend source and declared by no backend package", () => {
    const importers: string[] = [];
    const declarers: string[] = [];

    for (const root of backendRoots()) {
      for (const file of productionSources(path.join(root, "src"))) {
        const reaches = importsOf(file).some(
          (specifier) =>
            specifier === BROWSER_PACKAGE ||
            specifier.startsWith(`${BROWSER_PACKAGE}/`) ||
            /modules\/workflow\/browser/.test(specifier),
        );
        if (reaches) importers.push(path.relative(REPO_ROOT, file));
      }

      const manifest = path.join(root, "package.json");
      if (existsSync(manifest)) {
        const pkg = JSON.parse(readFileSync(manifest, "utf8")) as Record<
          string,
          Record<string, string> | undefined
        >;
        const declared = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
        if (BROWSER_PACKAGE in declared) declarers.push(path.relative(REPO_ROOT, manifest));
      }
    }

    expect(importers).toEqual([]);
    expect(declarers).toEqual([]);
  });

  /** @scenario "Local configuration dispatch stays portable" */
  it("is not how the server materialises execution DSL: it merges through the contract", () => {
    const service = path.join(PROCESS_ROOT, "src", "services", "workflow-studio-dsl.service.ts");
    const source = readFileSync(service, "utf8");

    expect(importsOf(service)).toContain("@langwatch/workflow-contract");
    expect(source).toMatch(/mergeLocalConfigsIntoDsl\(/);
  });
});
