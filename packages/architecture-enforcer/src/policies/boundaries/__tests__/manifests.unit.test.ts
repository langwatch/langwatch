import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildWorkspaceSnapshot } from "../../../workspace/snapshot.ts";
import { lintManifests } from "../manifests.ts";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "langwatch-manifests-"));
  write("pnpm-workspace.yaml", 'packages:\n  - "packages/*"\n');
  write("packages/target/package.json", JSON.stringify({ name: "@acme/target" }));
  write("packages/target/src/index.ts", "export const value = 1;\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function consumer({
  dependencies,
  files,
}: {
  dependencies: Record<string, string>;
  files: Record<string, string>;
}): void {
  write("packages/consumer/package.json", JSON.stringify({ name: "@acme/consumer", dependencies }));
  for (const [path, content] of Object.entries(files)) write(`packages/consumer/${path}`, content);
}

function dependencyUse(): string[] {
  return lintManifests(buildWorkspaceSnapshot({ root, changedFiles: [] }))
    .filter((violation) => violation.policy === "package-dependencies")
    .map((violation) => violation.message);
}

describe("lintManifests dependency use", () => {
  /** @scenario "An unused workspace dependency is refused" */
  it("refuses a workspace dependency no file imports", () => {
    consumer({
      dependencies: { "@acme/target": "workspace:*" },
      files: { "src/index.ts": "export const own = 1;\n" },
    });

    expect(dependencyUse()).toEqual([
      "@acme/consumer reads nothing from @acme/target: remove @acme/target from dependencies.",
    ]);
  });

  /** @scenario "A workspace dependency only tests import is refused in dependencies" */
  it("refuses a runtime dependency only a test imports", () => {
    consumer({
      dependencies: { "@acme/target": "workspace:*" },
      files: {
        "src/index.ts": "export const own = 1;\n",
        "src/__tests__/own.test.ts": 'vi.mock("@acme/target");\n',
      },
    });

    expect(dependencyUse()).toEqual([
      "Only @acme/consumer's tests read @acme/target: move @acme/target to devDependencies.",
    ]);
  });

  /** @scenario "A workspace dependency only tests import is refused in dependencies" */
  it("reads a .storybook config as test-side use", () => {
    write(
      "packages/consumer/package.json",
      JSON.stringify({
        name: "@acme/consumer",
        devDependencies: { "@acme/target": "workspace:*" },
        dependencies: { "@acme/other": "workspace:*" },
      }),
    );
    write("packages/other/package.json", JSON.stringify({ name: "@acme/other" }));
    write("packages/consumer/src/index.ts", "export const own = 1;\n");
    write(
      "packages/consumer/.storybook/preview.ts",
      'import "@acme/target";\nimport "@acme/other";\n',
    );

    expect(dependencyUse()).toEqual([
      "Only @acme/consumer's tests read @acme/other: move @acme/other to devDependencies.",
    ]);
  });

  /** @scenario "A workspace dependency its source imports passes" */
  it("accepts a dependency the source imports by a subpath", () => {
    consumer({
      dependencies: { "@acme/target": "workspace:*" },
      files: { "src/index.ts": 'export { value } from "@acme/target/src/index.ts";\n' },
    });

    expect(dependencyUse()).toEqual([]);
  });

  /** @scenario "A third-party dependency is never judged for use" */
  it("never judges a registry dependency", () => {
    consumer({
      dependencies: { zod: "^4.0.0" },
      files: { "src/index.ts": "export const own = 1;\n" },
    });

    expect(dependencyUse()).toEqual([]);
  });
});
