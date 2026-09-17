#!/usr/bin/env node
/**
 * L2: `moduleApi<Api>(id)` -> `moduleApi<Api>()(id)`.
 *
 * TypeScript will not infer `Id` while `Api` is given explicitly, so the token
 * can only carry its id if the call curries. Without the id in the type a peer
 * cannot be subtracted from what a process still owes (ADR-147).
 *
 * Usage: node dev/scripts/codemods/moduleapi-curry.mjs [--write]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const write = process.argv.includes("--write");
const CALL = /\bmoduleApi<([^>]+)>\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Z_][A-Z0-9_]*)\s*\)/g;

const files = execFileSync(
  "grep",
  ["-rl", "--include=*.ts", "-e", "moduleApi<", "modules", "enterprise", "packages", "apps"],
  { encoding: "utf8" },
)
  .split("\n")
  .filter((f) => f && !f.includes("node_modules") && !f.includes("/dist/"));

let changedFiles = 0;
let changedCalls = 0;
for (const file of files) {
  const before = readFileSync(file, "utf8");
  let count = 0;
  const after = before.replace(CALL, (match, api, id) => {
    // already curried
    if (match.endsWith(")(")) return match;
    count += 1;
    return `moduleApi<${api}>()(${id})`;
  });
  if (count === 0 || after === before) continue;
  changedFiles += 1;
  changedCalls += count;
  if (write) writeFileSync(file, after);
  else console.log(`${file}: ${count}`);
}

console.log(
  `${write ? "rewrote" : "would rewrite"} ${changedCalls} call(s) across ${changedFiles} file(s)`,
);
