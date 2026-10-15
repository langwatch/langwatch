/**
 * `dependency-catalog`, on fixtures.
 *
 * Spec: packages/architecture-enforcer/specs/dependency-catalog.feature.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { lintDependencyCatalog } from "../src/policies/quality/dependency-catalog.ts";
import { snapshotOf } from "./workspace.ts";

let root = "";

type Dependencies = Record<string, string>;

function workspace({
  catalog = "",
  members,
}: {
  catalog?: string;
  members: Record<string, Partial<Record<string, Dependencies>>>;
}): void {
  root = mkdtempSync(join(tmpdir(), "dependency-catalog-"));
  writeFileSync(join(root, "pnpm-workspace.yaml"), `packages:\n  - libs/*\n\n${catalog}`);

  for (const [name, fields] of Object.entries(members)) {
    mkdirSync(join(root, "libs", name), { recursive: true });
    writeFileSync(
      join(root, "libs", name, "package.json"),
      JSON.stringify({ name, ...fields }, null, 2),
    );
  }
}

function violations(): ReturnType<typeof lintDependencyCatalog> {
  return lintDependencyCatalog(snapshotOf({ root, packages: [] }));
}

describe("Dependency catalog", () => {
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
  });

  describe("when a catalogued package carries its own range", () => {
    /** @scenario "A dependency the catalog names is written with an explicit range" */
    it("reports the declaration and tells the author to write catalog:", () => {
      workspace({
        catalog: "catalog:\n  shiki: ^4.3.0\n",
        members: { a: { dependencies: { shiki: "^3.15.0" } } },
      });

      expect(violations()).toMatchObject([
        { policy: "dependency-catalog", file: join(root, "libs/a/package.json"), line: 4 },
      ]);
      expect(violations()[0]?.allowed).toContain('"catalog:"');
    });

    /** @scenario "A dependency a named catalog names is written with an explicit range" */
    it("reports a package a named catalog pins", () => {
      workspace({
        catalog: "catalogs:\n  sdk:\n    typescript: ^6.0.3\n",
        members: { a: { devDependencies: { typescript: "^5.0.0" } } },
      });

      expect(violations()).toHaveLength(1);
    });
  });

  describe("when two members declare a package the catalog does not name", () => {
    /** @scenario "A dependency two members declare is not in the catalog" */
    it("reports both manifests, with adding it to the catalog as the remedy", () => {
      workspace({
        members: {
          a: { dependencies: { pg: "^8.22.0" } },
          b: { optionalDependencies: { pg: "^8.22.0" } },
        },
      });

      expect(violations().map((found) => found.file)).toEqual([
        join(root, "libs/a/package.json"),
        join(root, "libs/b/package.json"),
      ]);
      expect(violations()[0]?.allowed).toContain("Add pg to the catalog in pnpm-workspace.yaml");
    });

    /** @scenario "A dependency only one member declares is left alone" */
    it("leaves a package one member declares", () => {
      workspace({ members: { a: { dependencies: { pg: "^8.22.0" } } } });

      expect(violations()).toEqual([]);
    });

    /** @scenario "A workspace, file or link dependency is not an external package" */
    it("ignores workspace, file and link ranges", () => {
      workspace({
        members: {
          a: { dependencies: { x: "workspace:*", y: "file:./y.tgz", z: "link:../z" } },
          b: { dependencies: { x: "workspace:*", y: "file:./y.tgz", z: "link:../z" } },
        },
      });

      expect(violations()).toEqual([]);
    });

    /** @scenario "A peer range is stated on purpose" */
    it("ignores peer dependencies", () => {
      workspace({
        members: {
          a: { peerDependencies: { react: "^18" } },
          b: { peerDependencies: { react: "^19" } },
        },
      });

      expect(violations()).toEqual([]);
    });
  });

  describe("when every shared dependency comes from the catalog", () => {
    /** @scenario "A member that takes every shared dependency from the catalog is silent" */
    it("reports nothing", () => {
      workspace({
        catalog: "catalog:\n  pg: ^8.22.0\ncatalogs:\n  sdk:\n    typescript: ^6.0.3\n",
        members: {
          a: { dependencies: { pg: "catalog:" }, devDependencies: { typescript: "catalog:sdk" } },
          b: { dependencies: { pg: "catalog:" } },
        },
      });

      expect(violations()).toEqual([]);
    });
  });
});
