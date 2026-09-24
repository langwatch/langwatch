#!/usr/bin/env node
/**
 * Every REST fact a route declares but nothing binds — `createRestRuntime`
 * refuses at MOUNT for each, one boot failure at a time. A fact binds by
 * identifier OR inline; self-test first, and refuses to scan if it fails.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const DEFINE = /(?:const|let)\s+([A-Za-z0-9_]+)\s*=\s*defineRestMiddleware\(\s*"([^"]+)"/g;
const DEFINE_ANY = /defineRestMiddleware\(\s*"([^"]+)"/g;
const BIND_INLINE = /bindRest(?:Middleware|Header)\(\s*defineRestMiddleware\(\s*"([^"]+)"/g;
const BIND_NAMED = /bindRest(?:Middleware|Header)\(\s*([A-Za-z0-9_]+)/g;

/** Declarations, their identifiers, and every binding, read out of one tree. */
function readDeclarations(sources) {
  const declaredIn = new Map();
  const factOfIdentifier = new Map();
  for (const [file, text] of sources) {
    for (const [, identifier, fact] of text.matchAll(DEFINE)) {
      factOfIdentifier.set(identifier, fact);
      if (!declaredIn.has(fact)) declaredIn.set(fact, file);
    }
    for (const [, fact] of text.matchAll(DEFINE_ANY)) {
      if (!declaredIn.has(fact)) declaredIn.set(fact, file);
    }
  }
  return { declaredIn, factOfIdentifier };
}

function scan(sources) {
  const { declaredIn, factOfIdentifier } = readDeclarations(sources);
  const bound = new Set();

  for (const [, text] of sources) {
    for (const [, fact] of text.matchAll(BIND_INLINE)) bound.add(fact);
    for (const [, identifier] of text.matchAll(BIND_NAMED)) {
      if (identifier === "defineRestMiddleware") continue;
      bound.add(factOfIdentifier.get(identifier) ?? identifier);
    }
  }

  return [...declaredIn]
    .filter(([fact]) => !bound.has(fact))
    .map(([fact, file]) => ({ fact, file }));
}

/** The two spellings, and the two ways an earlier draft got each one wrong. */
function selfTest() {
  const fixtures = [
    ["declared-and-never-bound.ts", 'const orphan = defineRestMiddleware("orphan", z.string());'],
    [
      "bound-by-identifier.ts",
      'const named = defineRestMiddleware("named", z.string());\n' +
        "bindRestMiddleware(named, () => null);",
    ],
    [
      "bound-inline.ts",
      'bindRestMiddleware(defineRestMiddleware("inline", z.string()), () => null);',
    ],
    [
      "bound-by-header.ts",
      'const viaHeader = defineRestMiddleware("viaHeader", z.string());\n' +
        'bindRestHeader(viaHeader, "authorization");',
    ],
  ];
  const reported = scan(fixtures).map(({ fact }) => fact);
  const expected = ["orphan"];

  if (reported.length !== expected.length || reported[0] !== expected[0]) {
    console.error(
      `Self-test failed: expected [${expected.join(",")}], got [${reported.join(",")}]. Refusing to scan.`,
    );
    process.exit(2);
  }
}

selfTest();

const files = execFileSync("git", ["ls-files", "*.ts"], { encoding: "utf8" })
  .split("\n")
  .filter(
    (file) =>
      file && !file.includes("/dist/") && !file.includes("__tests__") && !file.endsWith(".test.ts"),
  );

const sources = files.map((file) => [file, readFileSync(file, "utf8")]);
const unbound = scan(sources).toSorted((left, right) => left.fact.localeCompare(right.fact));

if (unbound.length === 0) {
  console.log("Every declared REST fact is bound.");
  process.exit(0);
}

const byOwner = new Map();
for (const { fact, file } of unbound) {
  const owner = file.split("/src/")[0];
  byOwner.set(owner, [...(byOwner.get(owner) ?? []), fact]);
}

console.log(`${unbound.length} declared REST facts have no binding anywhere:\n`);
for (const owner of [...byOwner.keys()].toSorted((a, b) => (a < b ? -1 : Number(a > b)))) {
  console.log(`  ${owner}`);
  for (const fact of byOwner.get(owner).toSorted()) console.log(`    ${fact}`);
}
console.log(
  "\nEach is a mount refusal: the process that mounts the declaring family " +
    "cannot boot until the fact is bound, by the module through " +
    "withTransportFacts or by the process at its mount.",
);
process.exit(1);
