import chalk from "chalk";

export function printBanner(version: string): void {
  // Box width = 45 chars between the │ pipes. Keep every line at exactly 45
  // visible chars (no escape codes, no emoji) or the rounded corners drift.
  const inside = (text: string) => {
    const padded = text.padStart(text.length + Math.floor((45 - text.length) / 2)).padEnd(45);
    return chalk.bold.cyan(`    │${padded}│`);
  };
  console.log("");
  console.log(chalk.bold.cyan("    ╭─────────────────────────────────────────────╮"));
  console.log(inside("LangWatch self-hosted"));
  console.log(inside(`v${version}`));
  console.log(chalk.bold.cyan("    ╰─────────────────────────────────────────────╯"));
  console.log(chalk.dim("    Observability, evaluations, and prompt-ops for your LLM stack."));
  console.log("");
}

export function printPhases(): void {
  const num = (n: number) => chalk.bold.cyan(`${n}.`);
  const lines = [
    `  ${num(1)} ${chalk.bold("predeps")}   ${chalk.dim("uv, postgres, redis, clickhouse, ai-gateway")}`,
    `  ${num(2)} ${chalk.bold("env")}       ${chalk.dim("scaffold ~/.langwatch/.env with locally-generated secrets")}`,
    `  ${num(3)} ${chalk.bold("services")}  ${chalk.dim("install python deps, build app, prepare data dirs")}`,
    `  ${num(4)} ${chalk.bold("start")}     ${chalk.dim("boot every service via concurrently and open your browser")}`,
  ];
  console.log(chalk.bold("    Plan:"));
  console.log("");
  for (const l of lines) console.log(l);
  console.log("");
}
