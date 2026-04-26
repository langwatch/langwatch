import chalk from "chalk";
import prompts from "prompts";
import { detectConflicts, killPidGroups, type ConflictReport } from "./detect.ts";
import { PORT_BASE_DEFAULT } from "../shared/ports.ts";

export type ResolvedPorts = {
  base: number;
  report: ConflictReport;
  resolution: "no-conflict" | "shifted" | "killed" | "manual";
};

export type ResolveOptions = {
  base?: number;
  yes?: boolean;
};

export async function resolvePortConflicts({ base = PORT_BASE_DEFAULT, yes = false }: ResolveOptions = {}): Promise<ResolvedPorts> {
  const report = await detectConflicts(base);
  if (report.conflicts.length === 0) {
    return { base, report, resolution: "no-conflict" };
  }

  printConflicts(report);

  if (yes && report.suggestedBase != null) {
    return reportShift(report.suggestedBase, report);
  }

  const choices = [
    ...(report.suggestedBase != null
      ? [{ title: `Shift to PORT=${report.suggestedBase}`, value: "shift" }]
      : []),
    { title: "Kill the conflicting processes", value: "kill" },
    { title: "Cancel and let me free the ports manually", value: "cancel" },
  ];

  const { choice } = await prompts(
    { type: "select", name: "choice", message: "How would you like to proceed?", choices, initial: 0 },
    { onCancel: () => process.exit(130) }
  );

  if (choice === "shift" && report.suggestedBase != null) {
    return reportShift(report.suggestedBase, report);
  }

  if (choice === "kill") {
    await killPidGroups(report.conflicts.map((c) => c.pid));
    const after = await detectConflicts(base);
    if (after.conflicts.length > 0) {
      console.error(chalk.red("✗ some processes refused to die — please free the ports manually"));
      process.exit(1);
    }
    return { base, report: after, resolution: "killed" };
  }

  console.error(chalk.yellow("Aborting — re-run when the ports are free."));
  process.exit(1);
}

function reportShift(newBase: number, report: ConflictReport): ResolvedPorts {
  console.log(chalk.cyan(`→ shifting to PORT=${newBase}.`));
  return { base: newBase, report, resolution: "shifted" };
}

function printConflicts(report: ConflictReport): void {
  console.log("");
  console.log(chalk.red.bold(`✗ port conflict — ${report.conflicts.length} of the LangWatch slots are already in use`));
  console.log("");
  for (const c of report.conflicts) {
    console.log(`  ${chalk.red("✗")} ${chalk.bold(c.port)} (${c.label}) held by pid ${c.pid}: ${c.command}`);
  }
  console.log("");
}
