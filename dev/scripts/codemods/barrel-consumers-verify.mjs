import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const MODULES = ["auth", "dashboard", "dataset", "entitlement", "evaluation", "evaluator",
  "log", "metric", "prompt", "role", "stored-object", "suite", "trace"];

let totalBroken = 0;
const byConsumerArea = new Map();

for (const m of MODULES) {
  const pkg = `@langwatch/${m}-server`;
  let files = "";
  try {
    files = execFileSync("grep", ["-rEln", `from "${pkg}"`, "modules", "apps", "packages", "enterprise",
      "--include=*.ts", "--include=*.tsx"], { encoding: "utf8", maxBuffer: 64e6 });
  } catch {
    continue;
  }
  const nowBarrel = readFileSync(`modules/${m}/server/src/index.ts`, "utf8");
  const headBarrel = execFileSync("git", ["show", `HEAD:modules/${m}/server/src/index.ts`], { encoding: "utf8" });

  const broken = [];
  for (const file of files.split("\n")) {
    if (!file || file.startsWith(`modules/${m}/`)) continue;
    const src = readFileSync(file, "utf8");
    const re = new RegExp(`import\\s+(?:type\\s+)?\\{([^}]*)\\}\\s+from\\s+"${pkg.replace("/", "\\/")}"`, "gs");
    let mm;
    while ((mm = re.exec(src))) {
      for (const raw of mm[1].split(",")) {
        const name = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
        if (!name) continue;
        const safe = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const inNow = new RegExp(`\\b${safe}\\b`).test(nowBarrel);
        const inHead = new RegExp(`\\b${safe}\\b`).test(headBarrel);
        // only a regression if the sweep removed it: present at HEAD, absent now
        if (!inNow && inHead) broken.push({ name, file });
      }
    }
  }
  if (broken.length) {
    const area = new Set(broken.map((b) => b.file.split("/").slice(0, 2).join("/")));
    console.log(`${m.padEnd(14)} ${String(broken.length).padStart(3)} names now unresolvable, consumers in: ${[...area].join(", ")}`);
    totalBroken += broken.length;
    for (const b of broken) {
      const a = b.file.split("/").slice(0, 2).join("/");
      byConsumerArea.set(a, (byConsumerArea.get(a) ?? 0) + 1);
    }
  }
}
console.log(`\nTOTAL ${totalBroken} external import bindings broken by the sweep`);
for (const [a, n] of [...byConsumerArea].toSorted((x, y) => y[1] - x[1])) console.log(`  ${a}: ${n}`);
