/**
 * Spec: specs/tooling/lint-runtime-dev-dependency.feature.
 * Record: dev/docs/plans/platform-architecture-blocks.md.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ClassifiedPackage, PackageManifest } from "../../../types.ts";
import { forgetFileListings } from "../../../workspace/layout.ts";
import { buildWorkspaceSnapshot } from "../../../workspace/snapshot.ts";
import {
  collectRuntimeDevDependencyImports,
  lintRuntimeDevDependency,
} from "../runtime-dev-dependency.ts";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "langwatch-runtime-dev-dependency-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  forgetFileListings();
});

function write({ path, content }: { path: string; content: string }): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function pkg({
  kind,
  manifest,
  base = "modules/a",
}: {
  kind: "contract" | "process" | "browser";
  manifest: PackageManifest;
  base?: string;
}): ClassifiedPackage {
  const packageRoot = join(root, base, kind);

  return {
    name: `@langwatch/a-${kind}`,
    root: packageRoot,
    manifestPath: join(packageRoot, "package.json"),
    manifest,
    kind,
    feature: "a",
    enterprise: base.startsWith("enterprise"),
  };
}

function read(packages: ClassifiedPackage[]): string[] {
  const snapshot = { ...buildWorkspaceSnapshot({ root, changedFiles: [] }), packages };

  return collectRuntimeDevDependencyImports(snapshot)
    .map((use) => `${use.file}:${use.line}|${use.packageName}`)
    .toSorted();
}

const DEV_ONLY: PackageManifest = {
  devDependencies: { "@langwatch/api-key-contract": "workspace:*" },
};

describe("runtime-dev-dependency", () => {
  describe("given a process package lists a package only in devDependencies", () => {
    describe("when a production file imports a value from it", () => {
      /** @scenario "A value import of a dev-only package in process code is reported" */
      it("reports the file, the package and the remedy", () => {
        write({
          path: "modules/a/process/src/rules/refusal.rules.ts",
          content:
            'import { KEY } from "@langwatch/api-key-contract/sub";\nexport const x = KEY;\n',
        });
        const snapshot = {
          ...buildWorkspaceSnapshot({ root, changedFiles: [] }),
          packages: [pkg({ kind: "process", manifest: DEV_ONLY })],
        };

        const [violation] = lintRuntimeDevDependency(snapshot);

        expect(violation?.file).toBe("modules/a/process/src/rules/refusal.rules.ts");
        expect(violation?.specifier).toBe("@langwatch/api-key-contract");
        expect(violation?.allowed).toContain(
          "Move @langwatch/api-key-contract to dependencies in modules/a/process/package.json",
        );
      });
    });

    describe("when a file re-exports from it and another imports it dynamically", () => {
      /** @scenario "A re-export and a dynamic import of a dev-only package are reported" */
      it("reports both", () => {
        write({
          path: "enterprise/modules/a/contract/src/a.ts",
          content: 'export { KEY } from "@langwatch/api-key-contract";\n',
        });
        write({
          path: "enterprise/modules/a/contract/src/b.ts",
          content: 'export const load = () => import("@langwatch/api-key-contract");\n',
        });

        expect(
          read([pkg({ kind: "contract", manifest: DEV_ONLY, base: "enterprise/modules/a" })]),
        ).toEqual([
          "enterprise/modules/a/contract/src/a.ts:1|@langwatch/api-key-contract",
          "enterprise/modules/a/contract/src/b.ts:1|@langwatch/api-key-contract",
        ]);
      });
    });

    describe("when it is also listed in dependencies or peerDependencies", () => {
      /** @scenario "A package listed in dependencies or peerDependencies passes" */
      it("reports nothing", () => {
        write({
          path: "modules/a/process/src/a.ts",
          content:
            'import { A } from "pkg-a";\nimport { B } from "pkg-b";\nexport const x = [A, B];\n',
        });

        expect(
          read([
            pkg({
              kind: "process",
              manifest: {
                dependencies: { "pkg-a": "1" },
                peerDependencies: { "pkg-b": "1" },
                devDependencies: { "pkg-a": "1", "pkg-b": "1" },
              },
            }),
          ]),
        ).toEqual([]);
      });
    });

    describe("when the imports are type-only", () => {
      /** @scenario "A type-only import of a dev-only package passes" */
      it("reports nothing", () => {
        write({
          path: "modules/a/process/src/a.ts",
          content:
            'import type { A } from "@langwatch/api-key-contract";\nimport { type B, type C } from "@langwatch/api-key-contract";\nexport type { D } from "@langwatch/api-key-contract";\nexport type X = [A, B, C];\n',
        });

        expect(read([pkg({ kind: "process", manifest: DEV_ONLY })])).toEqual([]);
      });
    });

    describe("when the importer is a test, a testing helper, a fixture or a declaration file", () => {
      /** @scenario "Tests, testing helpers and declaration files are skipped" */
      it("reports nothing", () => {
        const content =
          'import { KEY } from "@langwatch/api-key-contract";\nexport const x = KEY;\n';
        for (const path of [
          "modules/a/process/src/__tests__/a.ts",
          "modules/a/process/src/a.test.ts",
          "modules/a/process/src/a.spec.ts",
          "modules/a/process/src/testing.ts",
          "modules/a/process/src/testing/helper.ts",
          "modules/a/process/src/fixtures/a.ts",
          "modules/a/process/src/a.d.ts",
        ]) {
          write({ path, content });
        }

        expect(read([pkg({ kind: "process", manifest: DEV_ONLY })])).toEqual([]);
      });
    });
  });

  describe("given a browser package lists a package only in devDependencies", () => {
    describe("when a production file imports a value from it", () => {
      /** @scenario "Browser packages are out of scope" */
      it("reports nothing", () => {
        write({
          path: "modules/a/browser/src/a.ts",
          content: 'import { KEY } from "@langwatch/api-key-contract";\nexport const x = KEY;\n',
        });

        expect(read([pkg({ kind: "browser", manifest: DEV_ONLY })])).toEqual([]);
      });
    });
  });
});
