/** @vitest-environment node */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  defineTreeFacts,
  mayMention,
  mentionMatcher,
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

describe("the import walk", () => {
  it("records an import nested deep inside a subtree that names no other import", () => {
    const file = fixture({
      name: "nested.ts",
      text: 'const a = 1;\nexport function load() {\n  return () => [a, import("./lazy.ts"), require("./old.cjs")];\n}\n',
    });

    expect(moduleImports({ file }).map(({ specifier, dynamic }) => [specifier, dynamic])).toEqual([
      ["./lazy.ts", true],
      ["./old.cjs", true],
    ]);
  });

  it("walks a file whole when an escape could spell the import keyword", () => {
    const file = fixture({
      name: "escaped.ts",
      text: 'const x = "\\u0041";\nexport function load() {\n  return \\u0069mport("./lazy.ts");\n}\n',
    });

    expect(moduleImports({ file }).map(({ specifier }) => specifier)).toEqual(["./lazy.ts"]);
  });
});

describe("tree facts", () => {
  it("derives a file's facts during a read of its tree, and parses only an unread file", () => {
    let derivations = 0;
    const statementCount = defineTreeFacts({
      accept: (file) => file.endsWith(".facts.ts"),
      derive: ({ source }) => {
        derivations += 1;
        return source.statements.length;
      },
    });
    const read = fixture({ name: "read.facts.ts", text: "const a = 1;\nconst b = 2;\n" });
    const unread = fixture({ name: "unread.facts.ts", text: "const c = 3;\n" });

    readSourceOnce({ file: read, read: () => void 0 });
    expect(derivations).toBe(1);
    expect(statementCount(read)).toBe(2);
    expect(derivations).toBe(1);
    expect(statementCount(unread)).toBe(1);
    expect(derivations).toBe(2);
  });
});

describe("a word list matched against many files", () => {
  it("answers as mayMention does, escapes included", () => {
    const words = ["trace_summaries", "a.b(c)"];
    const files = [
      fixture({ name: "plain.ts", text: "SELECT * FROM trace_summaries" }),
      fixture({ name: "meta.ts", text: "call a.b(c) here" }),
      fixture({ name: "near.ts", text: "call aXb(c) here" }),
      fixture({ name: "escaped.ts", text: 'const t = "trace\\x5fsummaries";' }),
    ];
    const matches = mentionMatcher({ words });

    expect(files.map((file) => matches(file))).toEqual(
      files.map((file) => mayMention({ file, words })),
    );
    expect(files.map((file) => matches(file))).toEqual([true, true, false, true]);
  });
});
