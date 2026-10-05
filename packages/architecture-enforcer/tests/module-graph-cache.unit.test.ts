/** @vitest-environment node */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  mayMention,
  moduleImports,
  readSourceOnce,
  rendersJsx,
} from "../src/workspace/module-graph.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixture({ name, text }: { name: string; text: string }): string {
  const directory = mkdtempSync(join(tmpdir(), "langwatch-module-graph-"));
  temporaryDirectories.push(directory);
  const file = join(directory, name);
  writeFileSync(file, text);

  return file;
}

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

describe("a source read once", () => {
  it("leaves the import facts a cached parse would find", () => {
    const file = fixture({
      name: "subject.tsx",
      text: 'import { a } from "@fixture/a";\nexport const b = () => import("@fixture/b");\nexport const c = <a />;\n',
    });

    const statements = readSourceOnce({ file, read: (source) => source.statements.length });

    expect(statements).toBe(3);
    expect(
      moduleImports({ file }).map(({ specifier, dynamic }) => ({ specifier, dynamic })),
    ).toEqual([
      { specifier: "@fixture/a", dynamic: false },
      { specifier: "@fixture/b", dynamic: true },
    ]);
    expect(rendersJsx({ file })).toBe(true);
  });
});

describe("whether a file may mention a word", () => {
  it("is true when the word is written out", () => {
    const file = fixture({ name: "plain.ts", text: "export type T = ProjectionStore;\n" });

    expect(mayMention({ file, words: ["ProjectionStore"] })).toBe(true);
  });

  it("is false when no spelling of the word appears", () => {
    const file = fixture({ name: "absent.ts", text: "export const value = 1;\n" });

    expect(mayMention({ file, words: ["ProjectionStore"] })).toBe(false);
  });

  it("is true when only an escape could spell the word", () => {
    const file = fixture({
      name: "escaped.ts",
      text: 'export const name = "\\u0050rojectionStore";\n',
    });

    expect(mayMention({ file, words: ["ProjectionStore"] })).toBe(true);
  });
});
