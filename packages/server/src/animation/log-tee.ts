import chalk from "chalk";
import type { RuntimeEvent } from "../shared/runtime-contract.ts";

const COLORS: Record<string, (s: string) => string> = {
  langwatch: chalk.green,
  workers: chalk.bold.green,
  langwatch_nlp: chalk.cyan,
  nlp: chalk.cyan,
  langevals: chalk.magenta,
  aigateway: chalk.yellow,
  postgres: chalk.dim,
  redis: chalk.dim,
  clickhouse: chalk.dim,
  bullboard: chalk.gray,
};

const LABEL_WIDTH = 14;

function paint(service: string): string {
  const fn = COLORS[service] ?? chalk.white;
  return fn(service.padEnd(LABEL_WIDTH));
}

/**
 * Pretty-print one runtime event. Mirrors `concurrently`'s prefixed-line
 * style so the user feels at home if they've ever run `pnpm dev`.
 */
export function renderEvent(ev: RuntimeEvent): string | null {
  switch (ev.type) {
    case "starting":
      return `${chalk.dim("⋯")} ${paint(ev.service)} ${chalk.dim("starting…")}`;
    case "healthy":
      return `${chalk.green("✓")} ${paint(ev.service)} ${chalk.dim(`healthy in ${ev.durationMs}ms`)}`;
    case "log":
      return `${chalk.dim("│")} ${paint(ev.service)} ${ev.line.replace(/\r?\n$/, "")}`;
    case "crashed":
      return `${chalk.red("✗")} ${paint(ev.service)} ${chalk.red(`crashed (exit ${ev.code})`)}`;
    case "stopped":
      return `${chalk.yellow("⏻")} ${paint(ev.service)} ${chalk.dim("stopped")}`;
    default:
      return null;
  }
}

/**
 * Drain the runtime's event stream to the user's TTY, never blocking the
 * CLI's main flow. Returns an awaitable that resolves once the stream
 * closes — typically after `runtime.stopAll` is called and every
 * supervised child has exited.
 */
export async function streamEventsToTTY(events: AsyncIterable<RuntimeEvent>): Promise<void> {
  for await (const ev of events) {
    const line = renderEvent(ev);
    if (line) {
      process.stdout.write(`${line}\n`);
    }
  }
}
