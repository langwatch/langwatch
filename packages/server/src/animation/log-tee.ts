import { homedir } from "node:os";
import { join } from "node:path";
import chalk from "chalk";
import { paths } from "../shared/paths.ts";
import { exitCause, type RuntimeEvent } from "../shared/runtime-contract.ts";

const COLORS: Record<string, (s: string) => string> = {
	langwatch: chalk.green,
	workers: chalk.bold.green,
	nlpgo: chalk.cyan,
	langevals: chalk.magenta,
	aigateway: chalk.yellow,
	postgres: chalk.dim,
	redis: chalk.dim,
	clickhouse: chalk.dim,
	"prepare:app": chalk.blue,
	"prepare:langwatch": chalk.green,
	"prepare:langevals": chalk.magenta,
	"migrate:prisma": chalk.dim,
	"migrate:clickhouse": chalk.dim,
};

// Wide enough to fit `prepare:langevals` without breaking alignment when
// the install phase falls back to the prefixed-line renderer (no TTY,
// non-interactive shells, etc).
const LABEL_WIDTH = 22;

function paint(service: string): string {
	const fn = COLORS[service] ?? chalk.white;
	return fn(service.padEnd(LABEL_WIDTH));
}

function serviceLogPath(service: string): string {
	const full = join(paths.logs, `${service}.log`);
	const home = homedir();
	return full.startsWith(home) ? `~${full.slice(home.length)}` : full;
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
		case "restarting": {
			const delay =
				ev.delayMs % 1000 === 0 ? `${ev.delayMs / 1000}s` : `${ev.delayMs}ms`;
			return `${chalk.yellow("↻")} ${paint(ev.service)} ${chalk.yellow(
				`exited (${exitCause(ev)}), restarting in ${delay} (attempt ${ev.attempt}/${ev.maxAttempts})`,
			)}`;
		}
		case "crashed":
			return `${chalk.red("✗")} ${paint(ev.service)} ${chalk.red(
				`crashed (${exitCause(ev)}), see ${serviceLogPath(ev.service)}`,
			)}`;
		case "stopped":
			return `${chalk.yellow("⏻")} ${paint(ev.service)} ${chalk.dim("stopped")}`;
		default:
			return null;
	}
}

/**
 * Drain the runtime's event stream to the user's TTY, never blocking the
 * CLI's main flow. Returns an awaitable that resolves once the stream
 * closes, typically after `runtime.stopAll` is called and every
 * supervised child has exited.
 */
export async function streamEventsToTTY(
	events: AsyncIterable<RuntimeEvent>,
	options: { intercept?: (ev: RuntimeEvent) => boolean } = {},
): Promise<void> {
	const { intercept } = options;
	for await (const ev of events) {
		// Interceptor returns true to claim the event (e.g. routed into the
		// install-phase panel renderer) and skip the default scrolling render.
		if (intercept?.(ev)) continue;
		const line = renderEvent(ev);
		if (line) {
			process.stdout.write(`${line}\n`);
		}
	}
}
