#!/usr/bin/env node
/**
 * L4 worklist: a module's server barrel should export its installer and nothing
 * else. For every OTHER export, name who outside the module still imports it —
 * each one is either a module that should be installed or a peer that should be
 * provided, never a barrel export (ADR-147).
 *
 * Usage: node dev/scripts/codemods/barrel-consumers.mjs [module-name]
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { globSync } from "node:fs";

const only = process.argv[2];
const barrels = execFileSync("sh", ["-c",
  "ls modules/*/server/src/index.ts enterprise/modules/*/server/src/index.ts 2>/dev/null"],
  { encoding: "utf8" }).split("\n").filter(Boolean);

const NAMES = /^export\s+(?:type\s+)?\{([^}]*)\}/gm;
const rows = [];

for (const barrel of barrels) {
  const module = barrel.replace(/.*modules\/([^/]*)\/server.*/, "$1");
  if (only && module !== only) continue;
  const pkg = barrel.startsWith("enterprise/")
    ? `@langwatch/enterprise-${module}-server`
    : `@langwatch/${module}-server`;
  const src = readFileSync(barrel, "utf8");

  const exported = new Set();
  for (const m of src.matchAll(NAMES)) {
    for (const raw of m[1].split(",")) {
      const name = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()?.trim();
      if (name) exported.add(name);
    }
  }
  const installer = [...exported].find((n) => /Server$/.test(n));
  const surplus = [...exported].filter((n) => n !== installer);
  if (surplus.length === 0) continue;

  let consumers = "";
  try {
    consumers = execFileSync("grep", ["-rn", "--include=*.ts", pkg, "apps", "modules", "enterprise", "packages"],
      { encoding: "utf8" });
  } catch { consumers = ""; }
  const external = consumers.split("\n")
    .filter((l) => l && !l.includes("node_modules") && !l.includes("/dist/") && !l.startsWith(barrel.replace(/index\.ts$/, "")));

  const used = surplus.filter((name) =>
    external.some((line) => new RegExp(`\\b${name}\\b`).test(line)));

  rows.push({ module, installer: installer ?? "(none found)", surplus: surplus.length, stillUsed: used.length, used });
}

rows.sort((a, b) => b.stillUsed - a.stillUsed);
for (const r of rows) {
  console.log(`${r.module.padEnd(20)} installer=${r.installer.padEnd(26)} surplus=${String(r.surplus).padStart(3)}  still imported outside=${String(r.stillUsed).padStart(3)}`);
  if (only) for (const n of r.used) console.log(`    ${n}`);
}
const totalSurplus = rows.reduce((n, r) => n + r.surplus, 0);
const totalUsed = rows.reduce((n, r) => n + r.stillUsed, 0);
console.log(`\n${rows.length} modules · ${totalSurplus} surplus exports · ${totalUsed} still imported from outside the module`);
console.log(`${totalSurplus - totalUsed} can be deleted with no consumer change at all.`);
