#!/usr/bin/env node
// Renders one lane's structured log lines for a person, for the `pnpm dev`
// path that has no haven in front of it.
//
// This is the Node half of ONE written format spec —
// dev/docs/best_practices/dev-log-format.md. The Go half is
// tools/thuishaven/domain/logfmt, and both are asserted against the same
// fixture (dev/scripts/fixtures/dev-log-lines.jsonl -> .expected.txt), so the
// plain `pnpm dev` terminal and a `haven logs` view read identically.
//
//   <lane command> | node dev/scripts/log-render.mjs <lane> [--color|--no-color]

import { createInterface } from "node:readline";

/** The lane column fits "storybook"; the level column fits "error". */
export const LANE_WIDTH = 9;
export const LEVEL_WIDTH = 5;
const TIME_WIDTH = 12;
const STACK_INDENT = "    ";

/** The lane palette, mirroring tools/thuishaven/app/plan.go. */
export const LANE_COLORS = {
  ui: "34",
  api: "35",
  gateway: "33",
  nlp: "36",
  nlpgo: "36",
  langy: "92",
  idp: "92",
  workers: "32",
  storybook: "96",
  mail: "95",
};

const TIME_KEYS = ["time", "ts", "timestamp"];
const LEVEL_KEYS = ["level", "severity"];
const MESSAGE_KEYS = ["msg", "message"];
const STACK_KEYS = ["stack", "stacktrace"];

/**
 * Constant for the life of a process, so they say nothing a terminal line
 * needs — the lane column already names the service.
 */
const DROPPED_FIELDS = new Set([
  "pid",
  "hostname",
  "service",
  "version",
  "env",
  "service.version",
  "v",
]);

const NUMERIC_LEVELS = {
  10: "trace",
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "fatal",
};

const LEVEL_ALIASES = {
  trace: "trace",
  debug: "debug",
  info: "info",
  information: "info",
  notice: "info",
  warn: "warn",
  warning: "warn",
  error: "error",
  err: "error",
  dpanic: "error",
  fatal: "fatal",
  panic: "fatal",
  critical: "fatal",
};

const ESC = "\u001b";
const SGR_DIM = "2";
const SGR_YELLOW = "33";
const SGR_RED = "31";

/** Maps every spelling a library writes onto one word; "" when unrecognised. */
export function normalizeLevel(text) {
  return LEVEL_ALIASES[String(text).trim().toLowerCase()] ?? "";
}

function levelColor(level) {
  if (level === "debug" || level === "trace") return SGR_DIM;
  if (level === "warn") return SGR_YELLOW;
  if (level === "error" || level === "fatal") return SGR_RED;
  return "";
}

function paint(text, color, enabled) {
  return enabled && color ? `${ESC}[${color}m${text}${ESC}[0m` : text;
}

/** Left-aligns in a fixed column, never truncating. */
function pad(text, width) {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

/**
 * Both spellings of a numeric timestamp: zap writes epoch seconds with a
 * fraction, pino writes epoch milliseconds.
 */
function epochToDate(value) {
  return new Date(value > 1e12 ? value : value * 1000);
}

function firstString(raw, keys) {
  for (const key of keys) {
    if (typeof raw[key] === "string") return [raw[key], key];
  }
  return [void 0, void 0];
}

/** Reads one line as the shared structured format; null for anything else. */
export function parse(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  let raw;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;

  const used = new Set();
  let at;
  for (const key of TIME_KEYS) {
    const value = raw[key];
    if (typeof value === "string") {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        at = parsed;
        used.add(key);
        break;
      }
    } else if (typeof value === "number") {
      at = epochToDate(value);
      used.add(key);
      break;
    }
  }

  let level = "";
  for (const key of LEVEL_KEYS) {
    const value = raw[key];
    if (typeof value === "string" && normalizeLevel(value)) {
      level = normalizeLevel(value);
      used.add(key);
      break;
    }
    if (typeof value === "number" && NUMERIC_LEVELS[value]) {
      level = NUMERIC_LEVELS[value];
      used.add(key);
      break;
    }
  }

  const [message, messageKey] = firstString(raw, MESSAGE_KEYS);
  if (messageKey) used.add(messageKey);
  const [stack, stackKey] = firstString(raw, STACK_KEYS);
  if (stackKey) used.add(stackKey);

  // Some other tool's JSON (a manifest dump, a `--json` result). Passing it
  // through unchanged is more honest than rendering an empty log line.
  if (!message && !level) return null;

  const fields = Object.keys(raw)
    .filter((key) => !used.has(key) && !DROPPED_FIELDS.has(key))
    .sort()
    .map((key) => ({ key, value: renderValue(raw[key]) }));

  return { at, level, message: message ?? "", stack: stack ?? "", fields };
}

/**
 * Scalars bare, everything else compact JSON; a string is quoted only when
 * leaving it bare would make the key=value pair ambiguous.
 */
function renderValue(value) {
  if (typeof value === "string") {
    return value === "" || /[\s"=]/.test(value) ? JSON.stringify(value) : value;
  }
  return JSON.stringify(value);
}

/** Local wall time to the millisecond, or a blank column. */
function timeColumn(at) {
  if (!at || Number.isNaN(at.getTime())) return " ".repeat(TIME_WIDTH);
  const two = (value) => String(value).padStart(2, "0");
  const millis = String(at.getMilliseconds()).padStart(3, "0");
  return `${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}.${millis}`;
}

/**
 * Turns one captured line into what a person reads. The result may span
 * several lines when the record carries a stack trace.
 */
export function render(line, { lane = "", laneColor = "", at, color = false } = {}) {
  const record = parse(line);
  const columns = (level) =>
    `${paint(timeColumn(record?.at ?? at), SGR_DIM, color)}  ` +
    `${paint(pad(lane, LANE_WIDTH), laneColor, color)}  ` +
    level;

  if (!record) {
    return `${columns(" ".repeat(LEVEL_WIDTH))}  ${line.replace(/[\r\n]+$/, "")}`;
  }

  let out =
    columns(paint(pad(record.level, LEVEL_WIDTH), levelColor(record.level), color)) +
    `  ${record.message}`;
  for (const field of record.fields) {
    out += `  ${paint(`${field.key}=`, SGR_DIM, color)}${field.value}`;
  }
  if (record.stack) {
    for (const frame of record.stack.replace(/\n+$/, "").split("\n")) {
      out += `\n${paint(STACK_INDENT + frame.replace(/\r$/, ""), SGR_DIM, color)}`;
    }
  }
  return out;
}

/** Colour is off for a pipe, for NO_COLOR, and when asked. */
export function resolveColor(argv, env, isTTY) {
  if (argv.includes("--no-color")) return false;
  // NO_COLOR before --color: the lane wrapper always passes --color (its
  // stdout is a pipe into concurrently, not the terminal), so an explicit
  // NO_COLOR in the environment has to outrank it or it would never be heard.
  if (env.NO_COLOR) return false;
  if (argv.includes("--color")) return true;
  return Boolean(isTTY);
}

function main() {
  const args = process.argv.slice(2);
  const lane = args.find((arg) => !arg.startsWith("-")) ?? "";
  const color = resolveColor(args, process.env, process.stdout.isTTY);
  const laneColor = LANE_COLORS[lane] ?? "";
  const reader = createInterface({ input: process.stdin, crlfDelay: Infinity });
  reader.on("line", (line) => {
    process.stdout.write(`${render(line, { lane, laneColor, at: new Date(), color })}\n`);
  });
}

// Only when run as the command, so the test can import the renderer.
if (process.argv[1]?.endsWith("log-render.mjs")) main();
