/**
 * The body a `run` or an `estimate` sends, built from one command line.
 *
 * Two ways in and one body out. A caller who wrote a statement sends it; a
 * caller who has a question sends a target, a window, a filter and the
 * questions, and the platform writes the statement and hands it back. The
 * command refuses a line that says both, because a line that says both has no
 * reading: the statement would win and the target would be ignored, silently.
 *
 * Every refusal happens before anything is sent, so a malformed line never
 * leaves a run half-started.
 *
 * @see specs/features/instant-eval-cli.feature
 */

import type { InstantEvalRunBody } from "@/client-sdk/services/instant-evals";

import { commandValidationError, reportCommandError } from "../../utils/errorOutput";
import { parseInstantOrNull } from "../../utils/instant";
import { parseRunParameterFlags } from "../../utils/keyValueFlags";
import {
  type InstantEvalQuestionInput,
  type QuestionDraft,
  readQuestionFlags,
  readQuestionsFile,
} from "./questionFlags";

/** What a run may be asked of. `llm-spans` is the spelling on the line. */
export const INSTANT_EVAL_CLI_TARGETS = ["traces", "threads", "llm-spans"] as const;

export type InstantEvalCliTarget = (typeof INSTANT_EVAL_CLI_TARGETS)[number];

/** The target a row is, when the line names none. */
export const DEFAULT_INSTANT_EVAL_TARGET: InstantEvalCliTarget = "traces";

/** Rows a run judges when the line names no limit. */
export const DEFAULT_INSTANT_EVAL_LIMIT = 1_000;

/** Above this many rows, a plain run prints what it will cost before it starts. */
export const INSTANT_EVAL_ESTIMATE_FIRST_ROWS = 1_000;

/** The flags `run` and `estimate` share. */
export interface InstantEvalRunFlags {
  target?: string;
  filter?: string;
  last?: string;
  start?: string;
  end?: string;
  sql?: string;
  sqlFile?: string;
  param?: string[];
  questionsFile?: string;
  limit?: string;
  name?: string;
}

function refuse(message: string): never {
  reportCommandError({ error: commandValidationError(message) });
  process.exit(1);
}

/** How long `--last 7d` is, in milliseconds. */
const DURATION_UNITS: Readonly<Record<string, number>> = {
  m: 60 * 1_000,
  h: 60 * 60 * 1_000,
  d: 24 * 60 * 60 * 1_000,
  w: 7 * 24 * 60 * 60 * 1_000,
};

/** The widest window whose start is still a date JavaScript can hold. */
const MAX_WINDOW_MS = 8.64e15;

/** `--last 7d`, `--last 24h`, `--last 2w`. */
export function readLast(raw: string): number {
  const match = /^(\d+)\s*([mhdw])$/i.exec(raw.trim());
  if (!match) {
    refuse(
      `Invalid --last value: ${raw} (a window is written as a number and a unit, for example 7d, 24h, 30m or 2w)`,
    );
  }
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) {
    refuse(`Invalid --last value: ${raw} (it has to be a positive number)`);
  }
  const ms = amount * DURATION_UNITS[match[2]!.toLowerCase()]!;
  // The digits are unbounded, so a long enough run of them overflows to
  // Infinity, and even a finite one can name a window no instant can sit in.
  // Either way the start of the window is not a date, so it is refused here
  // rather than thrown at the caller as a RangeError.
  if (ms > MAX_WINDOW_MS) {
    refuse(`Invalid --last value: ${raw} (that window reaches past any date)`);
  }
  return ms;
}

/** The window the line asked for, as two instants, or nothing. */
function readWindow({ flags, now }: { flags: InstantEvalRunFlags; now: number }): {
  start?: string;
  end?: string;
} {
  if (flags.last !== undefined && (flags.start ?? flags.end) !== undefined) {
    refuse("Use --last, or --start with --end, not both.");
  }
  if (flags.last !== undefined) {
    const span = readLast(flags.last);
    return {
      start: new Date(now - span).toISOString(),
      end: new Date(now).toISOString(),
    };
  }
  return {
    ...(flags.start === undefined ? {} : { start: readInstant(flags.start, "--start") }),
    ...(flags.end === undefined ? {} : { end: readInstant(flags.end, "--end") }),
  };
}

function readInstant(raw: string, flag: string): string {
  const ms = parseInstantOrNull(raw);
  if (ms === null) {
    refuse(`Invalid ${flag} value: ${raw} (write an ISO 8601 timestamp, or epoch milliseconds)`);
  }
  return new Date(ms).toISOString();
}

function readLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_INSTANT_EVAL_LIMIT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    refuse(`Invalid --limit value: ${raw} (write a positive whole number of rows)`);
  }
  return value;
}

/** The statement the line named, read from the flag or from the file. */
async function readStatement(flags: InstantEvalRunFlags): Promise<string | undefined> {
  if (flags.sql !== undefined && flags.sqlFile !== undefined) {
    refuse("Use --sql, or --sql-file, not both.");
  }
  if (flags.sql !== undefined) return flags.sql;
  if (flags.sqlFile === undefined) return undefined;
  const { readFileSync } = await import("fs");
  try {
    return readFileSync(flags.sqlFile, "utf-8");
  } catch {
    refuse(`Could not read the statement file: ${flags.sqlFile}`);
  }
}

/** Whether the line described a shorthand at all. */
function namesShorthand(flags: InstantEvalRunFlags): boolean {
  return (
    flags.target !== undefined ||
    flags.filter !== undefined ||
    flags.last !== undefined ||
    flags.start !== undefined ||
    flags.end !== undefined ||
    flags.questionsFile !== undefined
  );
}

export async function buildInstantEvalRunBody({
  instructions,
  drafts,
  flags,
  now = Date.now(),
}: {
  /** The question written as the positional argument, when there was one. */
  instructions?: string;
  drafts: readonly QuestionDraft[];
  flags: InstantEvalRunFlags;
  now?: number;
}): Promise<InstantEvalRunBody> {
  const statement = await readStatement(flags);
  const questions = await readQuestions({ instructions, drafts, flags });

  if (statement !== undefined) {
    if (namesShorthand(flags) || questions.length > 0) {
      refuse(
        "A run takes a statement or a question, not both. Drop --sql to ask a question, or drop the question flags to run your statement.",
      );
    }
    return {
      sql: statement,
      ...parametersOf(flags),
      ...nameAndLimit(flags),
    } as InstantEvalRunBody;
  }

  if (questions.length === 0) {
    refuse(
      'Nothing to ask. Write the question as the argument (langwatch instant-eval run "the customer sounds annoyed"), or use --ask, --questions-file or --sql.',
    );
  }
  if (flags.param !== undefined && flags.param.length > 0) {
    refuse(
      "A target writes the statement and its parameters, so --param has nothing to fill. Send --sql to bind your own values.",
    );
  }

  return {
    target: apiTarget(flags.target),
    questions,
    ...(flags.filter === undefined ? {} : { filter: flags.filter }),
    ...readWindow({ flags, now }),
    ...nameAndLimit(flags),
  } as InstantEvalRunBody;
}

async function readQuestions({
  instructions,
  drafts,
  flags,
}: {
  instructions?: string;
  drafts: readonly QuestionDraft[];
  flags: InstantEvalRunFlags;
}): Promise<InstantEvalQuestionInput[]> {
  const written = readQuestionFlags({
    drafts,
    ...(instructions === undefined ? {} : { instructions }),
  });
  if (flags.questionsFile === undefined) return written;
  if (written.length > 0) {
    refuse(
      "Ask with the flags, or with --questions-file, not both: a file is the way to ask several questions that each carry their own criteria, scale or options.",
    );
  }
  return readQuestionsFile(flags.questionsFile);
}

/** `llm-spans` on the line is `llm_spans` on the wire. */
function apiTarget(raw: string | undefined): "traces" | "threads" | "llm_spans" {
  const named = (raw ?? DEFAULT_INSTANT_EVAL_TARGET).trim().toLowerCase();
  if (named === "traces" || named === "threads") return named;
  if (named === "llm-spans" || named === "llm_spans") return "llm_spans";
  refuse(`Invalid --target value: ${raw} (a row is one of ${INSTANT_EVAL_CLI_TARGETS.join(", ")})`);
}

function parametersOf(flags: InstantEvalRunFlags) {
  if (flags.param === undefined || flags.param.length === 0) return {};
  return { parameters: parseRunParameterFlags({ pairs: flags.param }) };
}

function nameAndLimit(flags: InstantEvalRunFlags) {
  return {
    limit: readLimit(flags.limit),
    ...(flags.name === undefined ? {} : { name: flags.name }),
  };
}
