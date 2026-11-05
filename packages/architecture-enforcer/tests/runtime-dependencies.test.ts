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

function peerProcess(peers: {
  peerDependencies: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional: boolean }>;
}): void {
  write(
    "modules/dataset/process/package.json",
    JSON.stringify({
      name: "@langwatch/dataset-process",
      type: "module",
      exports: { ".": "./src/index.ts" },
      ...peers,
    }),
  );
  write("modules/dataset/process/src/index.ts", 'import { z } from "zod";\nexport { z };\n');
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
    expect(lintRuntimeDependencies(snapshotOf({ root }))[0]?.allowed).toContain(
      "Move @langwatch/handled-error to dependencies in @langwatch/dataset-process's package.json",
    );
  });

  /** @scenario "A dev-only package the start script preloads is reported" */
  it("reports a dev-only import in a start-script preload", () => {
    datasetProcess({ section: "dependencies", service: "export const fail = () => 1;\n" });
    write(
      "apps/worker/package.json",
      JSON.stringify({
        name: "@langwatch/worker",
        type: "module",
        scripts: { start: "node --import @langwatch/preload/register src/main.ts" },
        dependencies: {
          "@langwatch/dataset-process": "workspace:*",
          "@langwatch/preload": "workspace:*",
        },
      }),
    );
    write(
      "packages/preload/package.json",
      JSON.stringify({
        name: "@langwatch/preload",
        type: "module",
        exports: { "./register": "./src/register.ts" },
        devDependencies: { "@langwatch/handled-error": "workspace:*" },
      }),
    );
    write("packages/preload/src/register.ts", 'import "@langwatch/handled-error";\n');

    expect(findings()).toEqual([
      { file: "packages/preload/src/register.ts", specifier: "@langwatch/handled-error" },
    ]);
  });

  /** @scenario "A peer the image install strips is not installed at runtime" */
  it("reports a value import of a peer the image pnpmfile strips", () => {
    write(
      "infra/docker/image.pnpmfile.cjs",
      'const DEV_TOOL_PEERS = [\n  "vite",\n  "typescript",\n];\n',
    );
    write(
      "modules/dataset/process/package.json",
      JSON.stringify({
        name: "@langwatch/dataset-process",
        type: "module",
        exports: { ".": "./src/index.ts" },
        peerDependencies: { typescript: "*" },
      }),
    );
    write("modules/dataset/process/src/index.ts", 'import ts from "typescript";\nexport { ts };\n');

    expect(findings()).toEqual([
      { file: "modules/dataset/process/src/index.ts", specifier: "typescript" },
    ]);
  });

  /** @scenario "A peer the image install keeps passes" */
  it("passes a value import of a peer the image pnpmfile keeps", () => {
    write("infra/docker/image.pnpmfile.cjs", 'const DEV_TOOL_PEERS = [\n  "typescript",\n];\n');
    peerProcess({ peerDependencies: { zod: "*" } });

    expect(findings()).toEqual([]);
  });

  /** @scenario "An optional peer the image install keeps passes" */
  it("passes a value import of an optional peer, which pnpm 12 installs", () => {
    peerProcess({
      peerDependencies: { zod: "*" },
      peerDependenciesMeta: { zod: { optional: true } },
    });

    expect(findings()).toEqual([]);
  });

  /** @scenario "A recipe written as --filter-prod=<package> is read" */
  it("reads a --filter-prod=<package> argument without the closure dots", () => {
    write(
      "infra/docker/prune-runtime-tree.sh",
      "pnpm install --frozen-lockfile --prod --filter-prod=@langwatch/worker\n",
    );
    datasetProcess({
      section: "devDependencies",
      service: 'import "@langwatch/handled-error";\n',
    });

    expect(findings()).toEqual([
      {
        file: "modules/dataset/process/src/services/upsert.service.ts",
        specifier: "@langwatch/handled-error",
      },
    ]);
  });

  /** @scenario "A recipe that names no workspace package fails loudly" */
  it("fails when --filter-prod names a package the workspace lacks", () => {
    write(
      "infra/docker/prune-runtime-tree.sh",
      'pnpm install --frozen-lockfile --prod --filter-prod "@langwatch/renamed-worker..."\n',
    );
    const [violation, ...rest] = lintRuntimeDependencies(snapshotOf({ root }));

    expect(rest).toEqual([]);
    expect(violation?.file).toBe(join(root, "infra/docker/prune-runtime-tree.sh"));
    expect(violation?.message).toContain("@langwatch/renamed-worker");
  });

  /** @scenario "A missing recipe fails loudly while the image is still built" */
  it("fails when the Dockerfile stays but the runtime recipe is gone", () => {
    write("infra/docker/Dockerfile", "FROM node\n");
    rmSync(join(root, "infra/docker/prune-runtime-tree.sh"));
    const [violation, ...rest] = lintRuntimeDependencies(snapshotOf({ root }));

    expect(rest).toEqual([]);
    expect(violation?.file).toBe(join(root, "infra/docker/Dockerfile"));
    expect(violation?.message).toContain("is gone");
  });

  /** @scenario "A workspace that builds no image is not judged" */
  it("ignores a workspace with neither a Dockerfile nor a runtime recipe", () => {
    rmSync(join(root, "infra/docker/prune-runtime-tree.sh"));

    expect(lintRuntimeDependencies(snapshotOf({ root }))).toEqual([]);
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
