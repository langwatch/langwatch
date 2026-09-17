import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const files = execFileSync("sh", ["-c",
  "grep -rl '@langwatch/[a-z-]*-web' apps modules packages enterprise --include=*.ts --include=*.tsx 2>/dev/null | grep -v node_modules || true"],
  { encoding: "utf8" }).split("\n").filter(Boolean);

const peersOf = new Map(); // specifier -> Set of consuming module
for (const f of files) {
  let src; try { src = readFileSync(f, "utf8"); } catch { continue; }
  if (!f.startsWith("modules/")) continue;           // peer consumers only
  const owner = f.split("/")[1];
  for (const m of src.matchAll(/from\s+"(@langwatch\/([a-z-]+)-web([^"]*))"/g)) {
    const [, spec, target] = m;
    if (owner === target) continue;
    if (!peersOf.has(spec)) peersOf.set(spec, new Set());
    peersOf.get(spec).add(owner);
  }
}

const buckets = new Map();
for (const [, who] of peersOf) buckets.set(who.size, (buckets.get(who.size) ?? 0) + 1);

console.log(`entries imported by at least one peer module: ${peersOf.size}\n`);
console.log("how many DIFFERENT modules import each one:");
for (const [n, count] of [...buckets].toSorted((a, b) => a[0] - b[0])) {
  console.log(`  used by ${n} peer module${n === 1 ? " " : "s"}: ${String(count).padStart(3)} entries`);
}
const single = [...peersOf].filter(([, w]) => w.size === 1);
const many = [...peersOf].filter(([, w]) => w.size >= 3);
console.log(`\nused by exactly one peer (coupling, not sharing): ${single.length}`);
console.log(`used by three or more peers (genuinely shared): ${many.length}`);
console.log("\nthe genuinely shared ones:");
for (const [spec, who] of many.toSorted((a, b) => b[1].size - a[1].size).slice(0, 15)) {
  console.log(`  ${String(who.size).padStart(2)}x  ${spec.replace("@langwatch/", "")}`);
}
