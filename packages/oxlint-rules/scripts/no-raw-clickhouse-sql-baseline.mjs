import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Writes src/rules/no-raw-clickhouse-sql.baseline.json from the rule's own findings over
// module code, counted with the baseline off. Shrink-only: refuses when any file's count
// rose; `--seed` is the one-time first write. ADR-202 §3.

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..", "..", "..");
const BASELINE = join(here, "..", "src", "rules", "no-raw-clickhouse-sql.baseline.json");
const PLUGIN = join(ROOT, "packages", "architecture-enforcer", "oxlint-plugin.mjs");
const RULE = "langwatch/no-raw-clickhouse-sql";
const CODE = "langwatch(no-raw-clickhouse-sql)";
const GOVERNED = ["modules", "enterprise/modules"];

function lintGoverned() {
  const directory = mkdtempSync(join(tmpdir(), "no-raw-clickhouse-sql-"));
  const config = join(directory, "oxlint.json");
  const rules = { [RULE]: ["error", { baseline: false }] };
  writeFileSync(
    config,
    JSON.stringify({ plugins: [], jsPlugins: [{ name: "langwatch", specifier: PLUGIN }], rules }),
  );
  try {
    const args = [
      "--silent",
      "exec",
      "oxlint",
      "--disable-nested-config",
      "-c",
      config,
      "-f",
      "json",
    ];
    const run = spawnSync("pnpm", [...args, ...GOVERNED], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    if (run.error) throw run.error;
    if (!run.stdout.trimStart().startsWith("{"))
      throw new Error(`oxlint gave no report:\n${run.stderr}`);

    return JSON.parse(run.stdout).diagnostics;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function countByFile(diagnostics) {
  const counts = new Map();
  for (const diagnostic of diagnostics) {
    if (diagnostic.code !== CODE) continue;
    counts.set(diagnostic.filename, (counts.get(diagnostic.filename) ?? 0) + 1);
  }

  return counts;
}

function main(argv) {
  const previous = JSON.parse(readFileSync(BASELINE, "utf8"));
  const current = countByFile(lintGoverned());
  const grown = [...current]
    .filter(([file, count]) => count > (previous.findings[file] ?? 0))
    .map(([file, count]) => `  ${file}: ${count} found, ${previous.findings[file] ?? 0} listed`);
  if (grown.length > 0 && !argv.includes("--seed")) {
    console.error(
      `${RULE}: the baseline only shrinks; build these reads instead:\n${grown.join("\n")}`,
    );
    return 1;
  }

  const findings = Object.fromEntries(
    [...current].toSorted(([left], [right]) => left.localeCompare(right)),
  );
  writeFileSync(
    BASELINE,
    `${JSON.stringify({ record: previous.record, findings }, null, 2)}\n`,
    "utf8",
  );
  const total = [...current.values()].reduce((sum, count) => sum + count, 0);
  const dropped = Object.keys(previous.findings).filter((file) => !current.has(file));
  console.log(
    `${RULE}: ${total} sites in ${current.size} files; ${dropped.length} files left the baseline.`,
  );

  return 0;
}

process.exitCode = main(process.argv.slice(2));
