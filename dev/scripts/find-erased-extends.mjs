#!/usr/bin/env node
/**
 * Finds `class X extends Y` where Y is bound as a TYPE ONLY.
 *
 * A type-only binding is erased by the compiler, so the `extends` clause names
 * a binding that does not exist at run time. The failure is a ReferenceError at
 * class-definition time — at BOOT, before any request, any test, any log line.
 * `tsc` would report it (TS2689 and friends), which is exactly why these
 * accumulate in code whose type check does not actually run: each application's
 * `typecheck` script is `typecheck:declarations ... && tsc --noEmit -p
 * tsconfig.test.json`, so a failing declarations pre-pass short-circuits the
 * `&&` and the application is never checked at all.
 *
 * Two spellings bind a name as a type, and the SECOND is the one that bites:
 *
 *     import type { A } from "x";        // whole-clause — the obvious one
 *     import { a, type B } from "x";     // inline specifier in a VALUE import
 *
 * The first version of this script understood only the first spelling and
 * reported a confident zero across 15,000 files. Every real instance used the
 * second. Hence `--self-test`: a detector nobody has watched fail is not a
 * detector, and this one has already been wrong once.
 *
 *     node dev/scripts/find-erased-extends.mjs [path]   # scan (default: git ls-files)
 *     node dev/scripts/find-erased-extends.mjs --self-test
 *
 * Prints `file:line  class X extends Y`, one per line. Exit 0 when clean, 1
 * when it finds something (so it can gate), 2 when the self-test fails.
 *
 * KNOWN LIMIT — it does not catch the sibling defect: an interface imported in
 * VALUE position (`import { IdentityEventing }` where the module declares an
 * interface). That erases at the module boundary rather than at the import, so
 * it needs cross-module resolution this script deliberately does not do. If you
 * are hunting boot-time ReferenceErrors, this covers one of the two shapes.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

/** Drops balanced <...> groups, so a generic constraint's `extends` is not read as a heritage clause. */
const stripGenerics = (text) => {
  let out = "";
  let depth = 0;
  for (const ch of text) {
    if (ch === "<") depth += 1;
    else if (ch === ">") depth = depth > 0 ? depth - 1 : 0;
    else if (depth === 0) out += ch;
  }
  return out;
};

/** Every name this source binds as a type only — and so erases at run time. */
export const typeOnlyNames = (src) => {
  const names = new Set();
  const add = (raw) => {
    const name = raw.trim().split(/\s+as\s+/).pop()?.trim();
    if (name) names.add(name);
  };
  for (const m of src.matchAll(/import\s+type\s+\{([^}]*)\}\s*from/g)) m[1].split(",").forEach(add);
  for (const m of src.matchAll(/import\s+type\s+([A-Za-z_$][\w$]*)\s+from/g)) names.add(m[1]);
  for (const m of src.matchAll(/import\s+(?!type\b)[^;]*?\{([^}]*)\}\s*from/gs))
    for (const part of m[1].split(",")) if (/^\s*type\s+/.test(part)) add(part.replace(/^\s*type\s+/, ""));
  return names;
};

/** The erased-extends sites in one source file. */
export const findInSource = (src) => {
  const found = [];
  if (!src.includes("extends") || !src.includes("type")) return found;
  const typeOnly = typeOnlyNames(src);
  if (typeOnly.size === 0) return found;
  const declaration = /(^|\n)\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)([^{]*)\{/g;
  for (const m of src.matchAll(declaration)) {
    const extended = stripGenerics(m[3]).match(/\bextends\s+([A-Za-z_$][\w$]*)/);
    if (extended && typeOnly.has(extended[1]))
      found.push({ line: src.slice(0, m.index).split("\n").length + 1, cls: m[2], base: extended[1] });
  }
  return found;
};

/**
 * Fixtures are the real shapes, not invented ones: the two positives are
 * apps/tasks defects as they stood at e8b0a63c62^, and the negatives are the
 * two false positives the first draft produced.
 */
const FIXTURES = [
  { want: true, name: "inline type specifier in a value import",
    src: `import { createTask, type StoredObjectsClickHouse } from "@langwatch/stored-object-server";\nclass TasksStoredObjectsClickHouse extends StoredObjectsClickHouse {\n  constructor() { super(); }\n}` },
  { want: true, name: "whole-clause type import",
    src: `import type { IdentityEventing } from "@langwatch/identity-server";\nclass TasksIdentityEventing extends IdentityEventing {}` },
  { want: false, name: "value import of the same name",
    src: `import { IdentityEventing } from "@langwatch/identity-server";\nclass StubIdentityEventing extends IdentityEventing {}` },
  { want: false, name: "generic constraint, not a heritage clause",
    src: `import type { Event } from "./events.ts";\nclass Pipeline<T extends Event> {\n  run(_e: T) {}\n}` },
];

const selfTest = () => {
  let bad = 0;
  for (const fixture of FIXTURES) {
    const got = findInSource(fixture.src).length > 0;
    if (got !== fixture.want) {
      console.error(`self-test FAILED: ${fixture.name} — expected ${fixture.want ? "a hit" : "no hit"}, got ${got ? "a hit" : "none"}`);
      bad += 1;
    }
  }
  if (bad > 0) return 2;
  console.log(`self-test passed (${FIXTURES.length} fixtures)`);
  return 0;
};

const listFiles = (target) => {
  if (!target)
    return execSync("git ls-files '*.ts' '*.tsx' | grep -vE '(^|/)(node_modules|dist)/'",
      { encoding: "utf8", maxBuffer: 1 << 28 }).trim().split("\n");
  const walk = (dir) => readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  return statSync(target).isDirectory() ? walk(target).filter((f) => /\.tsx?$/.test(f)) : [target];
};

const target = process.argv[2];
if (target === "--self-test") process.exit(selfTest());

// The detector is never run without its self-test: the one thing worse than no
// detector is one that reports clean because it cannot see.
if (selfTest() !== 0) process.exit(2);

const files = listFiles(target);
let hits = 0;
for (const file of files) {
  let src;
  try { src = readFileSync(file, "utf8"); } catch { continue; }
  for (const hit of findInSource(src)) {
    console.log(`${file}:${hit.line}  class ${hit.cls} extends ${hit.base}`);
    hits += 1;
  }
}
console.error(`scanned ${files.length} files, ${hits} erased-extends site${hits === 1 ? "" : "s"}`);
process.exit(hits > 0 ? 1 : 0);
