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

const only = process.argv[2];
const barrels = execFileSync("sh", ["-c",
  "ls modules/*/server/src/index.ts enterprise/modules/*/server/src/index.ts 2>/dev/null"],
  { encoding: "utf8" }).split("\n").filter(Boolean);

const NAMES = /^export\s+(?:type\s+)?\{([^}]*)\}/gm;

/** Every file importing any module-server package, read once and partitioned in
 *  memory: fifty-one whole-tree greps took minutes and this takes one.
 *  Statements, never lines - a multi-line import puts the package on its LAST
 *  line and every name it binds on the lines above, so a line-wise match sees
 *  none of them and reports a live name as deletable. */
const IMPORT_STATEMENT = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"(@langwatch\/[a-z0-9-]*-server)"/gs;
const ALL_IMPORTS = (() => {
  let files = [];
  try {
    files = execFileSync("grep", ["-rl", "--include=*.ts", "--include=*.tsx", "-e", "-server\"",
      "apps", "modules", "enterprise", "packages"],
      { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
      .split("\n")
      .filter((f) => f && !f.includes("node_modules") && !f.includes("/dist/"));
  } catch { return []; }
  const bindings = [];
  for (const file of files) {
    let src;
    try { src = readFileSync(file, "utf8"); } catch { continue; }
    for (const m of src.matchAll(IMPORT_STATEMENT)) {
      for (const raw of m[1].split(",")) {
        const name = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]?.trim();
        if (name) bindings.push({ file, pkg: m[2], name });
      }
    }
  }
  return bindings;
})();
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

  const own = barrel.replace(/index\.ts$/, "");
  const external = new Set(
    ALL_IMPORTS.filter((b) => b.pkg === pkg && !b.file.startsWith(own)).map((b) => b.name));

  const used = surplus.filter((name) => external.has(name));

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
