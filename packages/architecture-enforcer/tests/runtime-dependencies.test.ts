import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { lintRuntimeDependencies } from "../src/policies/quality/runtime-dependencies.ts";
import { snapshotOf } from "./workspace.ts";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "langwatch-runtime-dependencies-"));
  write("pnpm-workspace.yaml", 'packages:\n  - "apps/*"\n  - "modules/*/*"\n  - "packages/*"\n');
  write(
    "infra/docker/prune-runtime-tree.sh",
    'pnpm install --frozen-lockfile --prod --filter-prod "@langwatch/worker..."\n',
  );
  writePackage({
    path: "apps/worker",
    name: "@langwatch/worker",
    dependencies: { "@langwatch/dataset-process": "workspace:*" },
  });
  write("apps/worker/src/main.ts", 'import "@langwatch/dataset-process";\n');
  writePackage({ path: "packages/handled-error", name: "@langwatch/handled-error" });
  write("packages/handled-error/src/index.ts", "export class ValidationError extends Error {}\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function writePackage({
  path,
  name,
  dependencies = {},
  devDependencies = {},
}: {
  path: string;
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}): void {
  write(
    join(path, "package.json"),
    JSON.stringify({
      name,
      type: "module",
      exports: { ".": "./src/index.ts" },
      dependencies,
      devDependencies,
    }),
  );
}

function datasetProcess({
  section,
  service,
}: {
  section: "dependencies" | "devDependencies";
  service: string;
}): void {
  writePackage({
    path: "modules/dataset/process",
    name: "@langwatch/dataset-process",
    [section]: { "@langwatch/handled-error": "workspace:*" },
  });
  write("modules/dataset/process/src/index.ts", 'export * from "./services/upsert.service.ts";\n');
  write("modules/dataset/process/src/services/upsert.service.ts", service);
}

function findings(): { file: string; specifier?: string }[] {
  return lintRuntimeDependencies(snapshotOf({ root })).map((violation) => ({
    file: violation.file.slice(root.length + 1),
    specifier: violation.specifier,
  }));
}

describe("lintRuntimeDependencies", () => {
  /** @scenario "A dev-only package the server loads is reported" */
  it("reports a server-loaded file importing a dev-only package", () => {
    datasetProcess({
      section: "devDependencies",
      service:
        'import { ValidationError } from "@langwatch/handled-error";\nexport const fail = () => new ValidationError();\n',
    });

    expect(findings()).toEqual([
      {
        file: "modules/dataset/process/src/services/upsert.service.ts",
        specifier: "@langwatch/handled-error",
      },
    ]);
  });

  /** @scenario "A dev-only package only a type import names passes" */
  it("passes a type-only import of a dev-only package", () => {
    datasetProcess({
      section: "devDependencies",
      service:
        'import type { ValidationError } from "@langwatch/handled-error";\nexport type Failure = ValidationError;\n',
    });

    expect(findings()).toEqual([]);
  });

  /** @scenario "A dev-only package only a test imports passes" */
  it("passes a dev-only package only a test imports", () => {
    datasetProcess({ section: "devDependencies", service: "export const fail = () => 1;\n" });
    write(
      "modules/dataset/process/src/services/__tests__/upsert.service.test.ts",
      'import { ValidationError } from "@langwatch/handled-error";\nnew ValidationError();\n',
    );

    expect(findings()).toEqual([]);
  });

  /** @scenario "A package the server never loads is not judged" */
  it("ignores a package the runtime roots never reach", () => {
    datasetProcess({ section: "dependencies", service: "export const fail = () => 1;\n" });
    writePackage({
      path: "packages/tooling",
      name: "@langwatch/tooling",
      devDependencies: { "@langwatch/handled-error": "workspace:*" },
    });
    write("packages/tooling/src/index.ts", 'import "@langwatch/handled-error";\n');

    expect(findings()).toEqual([]);
  });

  /** @scenario "A runtime dependency the server loads passes" */
  it("passes a server-loaded import declared in dependencies", () => {
    datasetProcess({
      section: "dependencies",
      service:
        'import { ValidationError } from "@langwatch/handled-error";\nexport const fail = () => new ValidationError();\n',
    });

    expect(findings()).toEqual([]);
  });
});
