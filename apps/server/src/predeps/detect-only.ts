import chalk from "chalk";
import { paths } from "../shared/paths.ts";
import { predepRegistry } from "./registry.ts";
import type { LocalOrchestratorDevelopmentConfig } from "../platform/config/local-orchestrator.config.ts";

export type DoctorRow = {
  id: string;
  label: string;
  installed: boolean;
  version?: string;
  resolvedPath?: string;
  reason?: string;
};

export async function inspectPredeps({
  version,
  development,
}: {
  version: string;
  development: LocalOrchestratorDevelopmentConfig;
}): Promise<DoctorRow[]> {
  const predeps = predepRegistry({ version, development });
  const rows: DoctorRow[] = [];
  for (const p of predeps) {
    const det = await p.detect(paths);
    if (det.installed) {
      rows.push({
        id: p.id,
        label: p.label,
        installed: true,
        version: det.version,
        resolvedPath: det.resolvedPath,
      });
    } else {
      rows.push({ id: p.id, label: p.label, installed: false, reason: det.reason });
    }
  }
  return rows;
}

export function printDoctorTable(rows: DoctorRow[]): void {
  console.log("");
  console.log(chalk.bold("Predeps"));
  for (const r of rows) {
    if (r.installed) {
      console.log(
        `  ${chalk.green("✓")} ${r.id.padEnd(12)} ${r.version ?? ""} ${chalk.dim(r.resolvedPath ?? "")}`,
      );
    } else {
      console.log(`  ${chalk.red("✗")} ${r.id.padEnd(12)} ${chalk.dim(r.reason ?? "missing")}`);
    }
  }
  console.log("");
  const missing = rows.filter((r) => !r.installed);
  if (missing.length === 0) {
    console.log(chalk.green("All predeps installed."));
  } else {
    console.log(
      chalk.yellow(
        `${missing.length} predep(s) missing — run \`npx @langwatch/server install\` to fetch them.`,
      ),
    );
  }
}
