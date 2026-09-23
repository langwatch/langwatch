#!/usr/bin/env node
import { execFileSync } from "node:child_process";
/**
 * L2: `moduleApi<Api>(id)` to `moduleApi<Api>()(id)`, so the token carries its id in the type and a
 * peer can be subtracted from what a process owes (ADR-147). Usage: `node <this file> [--write]`.
 */
import { readFileSync, writeFileSync } from "node:fs";

const write = process.argv.includes("--write");
const CALL =
  /\bmoduleApi<([^>]+)>\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Z_][A-Z0-9_]*)\s*\)/g;

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
