import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const pkgs = execFileSync("sh", ["-c", "ls modules/*/web/package.json 2>/dev/null"], {
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);

// every specifier imported anywhere, with who imported it
const files = execFileSync(
  "sh",
  [
    "-c",
    "grep -rl '@langwatch/[a-z-]*-web' apps modules packages enterprise --include=*.ts --include=*.tsx 2>/dev/null | grep -v node_modules || true",
  ],
  { encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean);

const importers = new Map(); // specifier -> Set of importer kind
for (const f of files) {
  let src;
  try {
    src = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  const owner = f.startsWith("modules/") ? f.split("/")[1] : null;
  const kind = f.startsWith("apps/") ? "app" : "peer";
  for (const m of src.matchAll(/from\s+"(@langwatch\/([a-z-]+)-web([^"]*))"/g)) {
    const [, spec, target] = m;
    if (owner && owner === target) continue; // own package, not a boundary crossing
    if (!importers.has(spec)) importers.set(spec, new Set());
    importers.get(spec).add(kind);
  }
}

let appOnly = 0,
  peerToo = 0,
  unused = 0;
const peerEntries = [];
for (const p of pkgs) {
  const mod = p.split("/")[1];
  const exp = JSON.parse(readFileSync(p, "utf8")).exports ?? {};
  for (const key of Object.keys(exp)) {
    const spec = key === "." ? `@langwatch/${mod}-web` : `@langwatch/${mod}-web${key.slice(1)}`;
    const who = importers.get(spec);
    if (!who) {
      unused++;
      continue;
    }
    if (who.has("peer")) {
      peerToo++;
      peerEntries.push(`${mod}${key.slice(1) || " (root)"}`);
    } else {
      appOnly++;
    }
  }
}
console.log(`app-only entries (only apps/* imports them): ${appOnly}`);
console.log(`peer-importable entries (a module imports them): ${peerToo}`);
console.log(`entries nothing imports at all: ${unused}`);
console.log(`\npeer-importable, which is the tier that must be declared public:`);
console.log(
  peerEntries
    .slice(0, 40)
    .map((e) => `  ${e}`)
    .join("\n"),
);
