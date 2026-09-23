#!/usr/bin/env node
// Renders one lane's structured log lines for a person, for the `pnpm dev`
// path with no haven in front of it. The Node half of ONE format spec
// (dev/docs/best_practices/dev-log-format.md); the Go half is
// tools/thuishaven/domain/logfmt, both asserted against the same fixture.

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
  if (!trimmed.startsWith("{")) return null;
  if (!trimmed.endsWith("}")) return null;
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
      const timestamp = parsed.getTime();
      if (!Number.isNaN(timestamp)) {
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
    .toSorted()
    .map((key) => ({ key, value: renderValue(raw[key]) }));

  return readErrorOnce({ at, level, message: message ?? "", stack: stack ?? "", fields });
}

/**
 * Makes a failure record say its error once. Such a record commonly carries the same text three
 * times - as the message, as a serialised error, and as the stack's opening - so each copy is
 * reduced to what it alone adds: the error's type, and the frames.
 */
function readErrorOnce(record) {
  record.fields = compactRepeatedError(record.fields, record.message);
  const { type, frames, trimmed } = trimRepeatedStackHeader(record.stack, record.message);
  if (!trimmed) return record;
  record.stack = frames;
  // "Error" names nothing a reader did not already know.
  if (type && type !== "Error" && !record.fields.some((field) => field.key === "error")) {
    record.fields = [...record.fields, { key: "error", value: type }].toSorted(compareByKey);
  }
  return record;
}

function compareByKey(a, b) {
  if (a.key < b.key) return -1;
  return a.key > b.key ? 1 : 0;
}

/** Collapses every run of whitespace, so two copies indented differently match. */
const normalizeSpace = (text) => text.split(/\s+/).filter(Boolean).join(" ");

/**
 * Shortens a serialised error whose message the record already reads out. What
 * the copy alone adds is the error's type and code, so that is what is kept.
 */
function compactRepeatedError(fields, message) {
  return fields.map((field) => {
    if (field.key !== "error") return field;
    let error;
    try {
      error = JSON.parse(field.value);
    } catch {
      return field;
    }
    // A suffix, not an equal: a process failure composes its message as
    // "<what was happening>: <the error's own message>".
    if (!error?.message) return field;
    const repeatsMessage = normalizeSpace(message).endsWith(normalizeSpace(error.message));
    if (!repeatsMessage) return field;
    const kept = [error.type, error.code].filter(Boolean);
    return kept.length === 0 ? field : { key: field.key, value: kept.join(" ") };
  });
}

/**
 * Separates a stack's opening from its frames when the message has already read
 * that opening out. A Node stack begins "<Type>: <message>" before its frames,
 * so a record carrying both says the same thing twice.
 */
function trimRepeatedStackHeader(stack, message) {
  const kept = { type: "", frames: stack, trimmed: false };
  if (!stack || !message) return kept;
  const lines = stack.replace(/\n+$/, "").split("\n");
  const first = lines.findIndex((line) => line.trimStart().startsWith("at "));
  if (first <= 0) return kept;
  const header = lines.slice(0, first).join("\n");
  const at = header.indexOf(": ");
  const type = at === -1 ? "" : header.slice(0, at).trim();
  const body = at === -1 ? header : header.slice(at + 2);
  const repeatsMessage = normalizeSpace(message).includes(normalizeSpace(body));
  if (!repeatsMessage) return kept;
  return { type, frames: lines.slice(first).join("\n"), trimmed: true };
}

/**
 * Puts a message's own newlines under the column its first line starts at. A
 * record carrying an embedded block otherwise breaks the fixed columns at its
 * first newline and everything after it reads at the margin.
 */
function insetMessage(message) {
  return message.includes("\n")
    ? message.replace(/\n+$/, "").replaceAll("\n", `\n${STACK_INDENT}`)
    : message;
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
  if (!at) return " ".repeat(TIME_WIDTH);
  const millisAt = at.getTime();
  if (Number.isNaN(millisAt)) return " ".repeat(TIME_WIDTH);
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
    `  ${insetMessage(record.message)}`;
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
const entryFile = process.argv[1];
if (entryFile?.endsWith("log-render.mjs")) main();
