import { homedir } from "node:os";
import { join } from "node:path";

import chalk from "chalk";
import { z } from "zod";

import { paths } from "../shared/paths.ts";
import { exitCause, type RuntimeEvent } from "../shared/runtime-contract.ts";

const COLORS: Record<string, (s: string) => string> = {
  langwatch: chalk.green,
  go: chalk.cyan,
  nlpgo: chalk.cyan,
  langevals: chalk.magenta,
  aigateway: chalk.yellow,
  postgres: chalk.dim,
  redis: chalk.dim,
  clickhouse: chalk.dim,
  "prepare:langwatch": chalk.green,
  "prepare:langevals": chalk.magenta,
};

// Wide enough to fit `prepare:langevals` without breaking alignment.
const LABEL_WIDTH = 22;

function paint(service: string): string {
  const fn = COLORS[service] ?? chalk.white;
  return fn(service.padEnd(LABEL_WIDTH));
}

/** A path under the home directory, written from `~` as a person would type it. */
export function homePath(full: string): string {
  const home = homedir();
  return full.startsWith(home) ? `~${full.slice(home.length)}` : full;
}

function serviceLogPath(service: string): string {
  return homePath(join(paths.logs, `${service}.log`));
}

const stripEol = (line: string) => line.replace(/\r?\n$/, "");

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
      return `${chalk.dim("│")} ${paint(ev.service)} ${stripEol(ev.line)}`;
    case "restarting": {
      const delay = ev.delayMs % 1000 === 0 ? `${ev.delayMs / 1000}s` : `${ev.delayMs}ms`;
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

// The JSON record every service writes (dev/docs/best_practices/dev-log-format.md); pino's
// numeric levels are read too, error being 50.
const ERROR_LEVEL_NUMBER = 50;
const ERROR_LEVELS = new Set(["error", "fatal"]);
const CRASH_TAIL_LINES = 20;
const errorCause = z.object({ message: z.string() }).optional().catch(undefined);
const logRecord = z.object({
  level: z.union([z.string(), z.number()]),
  msg: z.string().optional(),
  err: errorCause,
  error: errorCause,
});

type LogRecord = z.infer<typeof logRecord>;
type LogEvent = Extract<RuntimeEvent, { type: "log" }>;

function readRecord(line: string): LogRecord | null {
  if (!line.trimStart().startsWith("{")) return null;
  try {
    const parsed = logRecord.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** A record's message, followed by its error's when that says something more. */
function recordText(record: LogRecord): string {
  const message = record.msg ?? "";
  const cause = (record.err ?? record.error)?.message ?? "";
  if (cause === "" || cause === message) return message;
  return message === "" ? cause : `${message}: ${cause}`;
}

function isErrorRecord(record: LogRecord): boolean {
  const { level } = record;
  return typeof level === "number" ? level >= ERROR_LEVEL_NUMBER : ERROR_LEVELS.has(level);
}

/** The readable text of a service's JSON record at error or above; null for any other line. */
export function errorRecordText(line: string): string | null {
  const record = readRecord(line);
  if (record === null || !isErrorRecord(record)) return null;
  return recordText(record) || "error";
}

/** At the default level: the CLI's own notices and a service's errors, one line each. */
function quietLogLine(ev: LogEvent): string | null {
  if (ev.isNotice === true) {
    return `${chalk.yellow("│")} ${paint(ev.service)} ${chalk.yellow(stripEol(ev.line))}`;
  }
  const text = errorRecordText(ev.line);
  return text === null ? null : `${chalk.red("✗")} ${paint(ev.service)} ${chalk.red(text)}`;
}

/** One line of a crash's log tail: a JSON record as its level and message, else as written. */
function tailLine(line: string): string {
  const record = readRecord(line);
  const text = record === null ? stripEol(line) : `${String(record.level)} ${recordText(record)}`;
  return `  ${chalk.dim("│")} ${chalk.dim(text)}`;
}

/**
 * Renders the runtime's events for the terminal. Quiet (the default): progress, status, the CLI's
 * notices and a service's errors, and a crash with the last lines of that service's log. Verbose:
 * every line each service writes as well, prefixed with its name (spec 11-terminal-output).
 */
export function terminalRenderer({
  showsServiceOutput,
}: {
  showsServiceOutput: boolean;
}): (ev: RuntimeEvent) => string | null {
  const recent = new Map<string, string[]>();
  const remember = ({ service, line }: LogEvent) => {
    const lines = recent.get(service) ?? [];
    lines.push(line);
    recent.set(service, lines.slice(-CRASH_TAIL_LINES));
  };
  return (ev) => {
    if (ev.type === "log") remember(ev);
    if (showsServiceOutput) return renderEvent(ev);
    if (ev.type === "log") return quietLogLine(ev);
    const line = renderEvent(ev);
    if (ev.type !== "crashed" || line === null) return line;
    return [line, ...(recent.get(ev.service) ?? []).map(tailLine)].join("\n");
  };
}

/**
 * Writes to stdout, holding every line while `until` is pending: services start while the
 * predep installs still draw their progress, and a line written under that drawing breaks it.
 */
export function heldOutput({ until }: { until: Promise<unknown> }): (text: string) => void {
  let held: string[] | null = [];
  const release = () => {
    for (const text of held ?? []) process.stdout.write(text);
    held = null;
  };
  until.then(release).catch(release);
  return (text) => {
    if (held) held.push(text);
    else process.stdout.write(text);
  };
}

/**
 * Drains the runtime's event stream to the user's TTY without blocking
 * the CLI's main flow. Resolves once the stream closes.
 */
export async function streamEventsToTTY(
  events: AsyncIterable<RuntimeEvent>,
  options: {
    intercept?: (ev: RuntimeEvent) => boolean;
    write?: (text: string) => void;
    showsServiceOutput?: boolean;
  } = {},
): Promise<void> {
  const { intercept, write = (text: string) => void process.stdout.write(text) } = options;
  const render = terminalRenderer({ showsServiceOutput: options.showsServiceOutput ?? true });
  for await (const ev of events) {
    // Interceptor returns true to claim the event and skip the default scrolling render.
    if (intercept?.(ev)) continue;
    const line = render(ev);
    if (line) write(`${line}\n`);
  }
}
