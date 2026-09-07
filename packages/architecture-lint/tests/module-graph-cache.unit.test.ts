/** @vitest-environment node */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { moduleImports, rendersJsx } from "../src/module-graph.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("module graph source cache", () => {
  it("refreshes import and JSX facts when one source path is edited", () => {
    const directory = mkdtempSync(join(tmpdir(), "langwatch-module-graph-"));
    temporaryDirectories.push(directory);
    const source = join(directory, "subject.tsx");

    writeFileSync(source, 'import { first } from "@fixture/first";\nexport const value = first;\n');
    expect(moduleImports({ file: source }).map(({ specifier }) => specifier)).toEqual([
      "@fixture/first",
    ]);
    expect(rendersJsx({ file: source })).toBe(false);

    writeFileSync(
      source,
      'import { second } from "@fixture/second";\nexport const value = <second />;\n',
    );
    expect(moduleImports({ file: source }).map(({ specifier }) => specifier)).toEqual([
      "@fixture/second",
    ]);
    expect(rendersJsx({ file: source })).toBe(true);
  });
});
