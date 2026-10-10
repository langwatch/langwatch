/**
 * `workspace-seams`, on fixtures.
 *
 * Spec: packages/architecture-enforcer/specs/workspace-seams.feature.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { lintWorkspaceSeams } from "../src/policies/quality/workspace-seams.ts";
import { snapshotOf } from "./workspace.ts";

let root = "";

function policy(name: string, contents: string): void {
  root ||= mkdtempSync(join(tmpdir(), "workspace-seams-"));

  const enforcer = join(root, "packages/architecture-enforcer");
  mkdirSync(join(enforcer, "src/policies"), { recursive: true });
  writeFileSync(
    join(enforcer, "package.json"),
    JSON.stringify({ name: "@langwatch/architecture-enforcer", private: true }),
  );
  writeFileSync(join(enforcer, "src/policies", name), contents);
}

function violations(): ReturnType<typeof lintWorkspaceSeams> {
  return lintWorkspaceSeams(
    snapshotOf({
      root,
      packages: [
        {
          name: "@langwatch/architecture-enforcer",
          root: join(root, "packages/architecture-enforcer"),
          manifestPath: join(root, "packages/architecture-enforcer/package.json"),
          manifest: { name: "@langwatch/architecture-enforcer" },
          kind: "tooling",
          enterprise: false,
        },
      ],
    }),
  );
}

describe("Workspace seams", () => {
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
  });

  describe("when a policy reads the tree for itself", () => {
    /** @scenario "A policy that parses with the compiler API directly is reported" */
    it("reports a direct compiler parse, with the shared cache as the remedy", () => {
      policy(
        "stray-parse.ts",
        ['import ts from "typescript";', "", "const tree = ts.createSourceFile();", ""].join("\n"),
      );

      expect(violations()).toMatchObject([
        {
          policy: "workspace-seams",
          file: join(root, "packages/architecture-enforcer/src/policies/stray-parse.ts"),
          line: 3,
          message: "An architecture policy may not call createSourceFile directly.",
        },
      ]);

      expect(violations()[0]?.allowed).toContain("sourceFile({ file })");
    });

    /** @scenario "A policy that walks the tree for itself is reported" */
    it("reports the raw directory walk, with the memoised listing as the remedy", () => {
      policy(
        "stray-walk.ts",
        ['import { walkFiles } from "../workspace/layout.ts";', "", "walkFiles();", ""].join("\n"),
      );

      expect(violations()).toMatchObject([
        { policy: "workspace-seams", line: 1, message: expect.stringContaining("walkFiles") },
      ]);

      expect(violations()[0]?.allowed).toContain("snapshot.files");
    });

    /** @scenario "A policy that builds its own module resolver is reported" */
    it("reports the resolver constructor, with the snapshot's resolver as the remedy", () => {
      policy(
        "stray-resolver.ts",
        [
          'import { createWorkspaceModuleResolver } from "../workspace/module-graph.ts";',
          "",
          "createWorkspaceModuleResolver();",
          "",
        ].join("\n"),
      );

      expect(violations()).toMatchObject([
        {
          policy: "workspace-seams",
          line: 1,
          message: expect.stringContaining("createWorkspaceModuleResolver"),
        },
      ]);

      expect(violations()[0]?.allowed).toContain("snapshot.resolver");
    });

    /** @scenario "An alias is the same reach, so it is reported where the name is bound" */
    it("reports an aliased import at the name it binds", () => {
      policy(
        "aliased-walk.ts",
        ['import { walkFiles as scan } from "../workspace/layout.ts";', "", "scan();", ""].join(
          "\n",
        ),
      );

      expect(violations()).toHaveLength(1);
      expect(violations()[0]?.line).toBe(1);
    });
  });

  describe("when a policy reads through the shared seams", () => {
    /** @scenario "A policy reading through the shared seams is silent" */
    it("reports nothing", () => {
      policy(
        "shared.ts",
        [
          'import ts from "typescript";',
          'import { listFiles } from "../workspace/layout.ts";',
          'import { sourceFile, workspaceModuleResolver } from "../workspace/module-graph.ts";',
          "",
          "export function read(root: string) {",
          '  const files = listFiles({ directory: root, accept: (path) => path.endsWith(".ts") });',
          "  const resolver = workspaceModuleResolver({ root });",
          "",
          "  return files.map((file) => ts.isSourceFile(sourceFile({ file })) && resolver);",
          "}",
          "",
        ].join("\n"),
      );

      expect(violations()).toEqual([]);
    });
  });
});
