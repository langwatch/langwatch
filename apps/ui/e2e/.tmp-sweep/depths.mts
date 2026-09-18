import { readFileSync } from "node:fs";

const text = readFileSync("/Users/lw/.claude/jobs/a413df06/tmp/failing-sql.txt", "utf8");
const blocks = text.split(/^=== .* ===$/m).filter((b) => b.trim());
const sql = blocks[0]!;

// same masking the guard does, approximated: strip string literals and comments
const masked = sql.replace(/'(?:[^'\\]|\\.)*'/g, (m) => " ".repeat(m.length));

const predIdx = masked.search(/TenantId\s*=\s*\{/);
let depth = 0, predDepth = 0;
const ors: { depth: number; line: number; text: string }[] = [];
const lineOf = (i: number) => masked.slice(0, i).split("\n").length;
for (let i = 0; i < masked.length; i++) {
  if (i === predIdx) predDepth = depth;
  const c = masked[i];
  if (c === "(") { depth++; continue; }
  if (c === ")") { depth--; continue; }
  if ((c === "o" || c === "O") && (masked[i+1] === "r" || masked[i+1] === "R")) {
    const before = masked[i-1] ?? " ", after = masked[i+2] ?? " ";
    if (!/[A-Za-z0-9_]/.test(before) && !/[A-Za-z0-9_]/.test(after)) {
      ors.push({ depth, line: lineOf(i), text: sql.split("\n")[lineOf(i)-1]!.trim().slice(0, 110) });
    }
  }
}
console.log("predicate at line", lineOf(predIdx), "depth", predDepth);
const offenders = ors.filter((o) => o.depth <= predDepth);
console.log("total ORs:", ors.length, "| OFFENDING (depth <= predicate):", offenders.length);
for (const o of offenders) console.log(`  line ${o.line} depth ${o.depth}: ${o.text}`);
