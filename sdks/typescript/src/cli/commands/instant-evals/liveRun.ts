/**
 * What `instant-eval run` shows while judging (statement, price, progress) and what it leaves when
 * done: rows matched, cost and the first rows.
 * @see specs/features/instant-eval-cli.feature
 */

import chalk from "chalk";

import type {
  InstantEvalJudgment,
  InstantEvalRun,
  InstantEvalsApiService,
} from "@/client-sdk/services/instant-evals";

import { formatTable } from "../../utils/formatting";
import { createSpinner } from "../../utils/spinner";
import { money } from "./render";

/** Rows the final table holds unless `--show` says otherwise. */
export const DEFAULT_INSTANT_EVAL_SHOW_ROWS = 20;

/** Rows one sample may re-read, which is the server's own ceiling. */
export const INSTANT_EVAL_SHOW_CEILING = 25;

const POLL_INTERVAL_MS = 1_000;

/**
 * How long a blocking run follows before it gives up and hands back the id. A run is followed to
 * its end, but not forever: a wedged run would otherwise hold the terminal with no way out but
 * Ctrl-C. The same ceiling `--wait` carried before waiting became the default.
 */
export const DEFAULT_INSTANT_EVAL_FOLLOW_MS = 45 * 60 * 1_000;

/** Consecutive read failures before the command stops waiting on the run. */
const MAX_CONSECUTIVE_POLL_FAILURES = 5;

const grouped = (value: number): string => value.toLocaleString("en-US");

/** "1.9M", "612K", "840". Token counts are read at a glance, not summed. */
function compactTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

/** "12s", "1m 04s". */
export function elapsedLabel(ms: number): string {
  const seconds = ms / 1_000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(Math.floor(seconds % 60)).padStart(2, "0")}s`;
}

/** Whether every question the run asks answers yes or no. */
function isBooleanRun(run: InstantEvalRun): boolean {
  return run.questions.length > 0 && run.questions.every((question) => question.kind === "boolean");
}

/** The noun for one row of this run, so the headline reads as the thing counted. */
function rowNoun(run: InstantEvalRun): string {
  const sql = run.sql.toLowerCase();
  if (sql.includes("group by") && sql.includes("conversationid")) {
    return "conversations";
  }
  if (sql.includes("spanattributes['langwatch.span.type']")) {
    return "model calls";
  }
  return "traces";
}

/**
 * `Judging 3,200/10,000 · 412 matched · 1.9M tokens · 12s`.
 *
 * Updated in place, so it carries everything that moves while the run works.
 */
export function instantEvalProgressLine(run: InstantEvalRun, elapsedMs: number): string {
  const total = run.total ?? run.limit;
  const parts = [`Judging ${grouped(run.progress)}/${grouped(total)}`];
  if (run.matched !== null) parts.push(`${grouped(run.matched)} matched`);
  if (run.tokens > 0) parts.push(`${compactTokens(run.tokens)} tokens`);
  parts.push(elapsedLabel(elapsedMs));
  return parts.join(" · ");
}

/**
 * `Found 412 matches in 10,000 conversations · 20.4s · 6.1M tokens · $0.33`. A run whose questions
 * are not all yes or no counts nothing, because a score or a label has no threshold to be on the
 * far side of, so it reports what it read instead.
 */
export function instantEvalHeadline(run: InstantEvalRun, elapsedMs: number): string {
  // A run that did not finish judged what it judged, not what it selected: a
  // failed run reporting its whole selection as judged reads as a success.
  const total = run.status === "finished" ? (run.total ?? run.progress) : run.progress;
  const noun = rowNoun(run);
  const head =
    isBooleanRun(run) && run.matched !== null
      ? `Found ${chalk.green(grouped(run.matched))} matches in ${grouped(total)} ${noun}`
      : `Judged ${grouped(total)} ${noun}`;
  return [
    head,
    elapsedLabel(elapsedMs),
    `${compactTokens(run.tokens)} tokens`,
    money(run.priceUsd),
  ].join(" · ");
}

/** What one judgement answered, in the shortest true form. */
function verdictOf(judgment: InstantEvalJudgment): string {
  if (judgment.status !== "judged") return judgment.status;
  if (judgment.label !== null) {
    const probability =
      judgment.probability === null ? "" : ` (${judgment.probability.toFixed(2)})`;
    return `${judgment.label}${probability}`;
  }
  if (judgment.score !== null) return judgment.score.toFixed(2);
  if (judgment.probability !== null) {
    const yes = judgment.passed ? "yes" : "no";
    return `${yes} (${judgment.probability.toFixed(2)})`;
  }
  return judgment.passed ? "yes" : "no";
}

/** One row's text, on one line, short enough to sit in a column. */
function preview(text: unknown, width: number): string {
  if (typeof text !== "string" || text === "") return "";
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= width ? flat : `${flat.slice(0, width - 1)}…`;
}

/**
 * The text a row was judged on, taken from whichever column holds it. The statement names its own
 * text column, so the row is searched for the longest string that is not one of the keys, which is
 * what the extraction function returned.
 */
function textOf(row: Record<string, unknown>): string {
  const keys = new Set(["TraceId", "SpanId", "ThreadId", "OccurredAt"]);
  let longest = "";
  for (const [key, value] of Object.entries(row)) {
    if (keys.has(key)) continue;
    if (typeof value === "string" && value.length > longest.length) {
      longest = value;
    }
  }
  return longest;
}

/** The first rows of the run, with what each question answered for them. */
export function printInstantEvalRows({
  rows,
  judgments,
  run,
}: {
  rows: readonly Record<string, unknown>[];
  judgments: readonly InstantEvalJudgment[];
  run: InstantEvalRun;
}): void {
  if (rows.length === 0) return;

  const questionIds = run.questions.map((question) => question.id);
  // A row is named by the thing the target counts, so a conversation run is
  // listed by conversation and a model-call run by span. Naming every row by
  // its trace reads as duplicates whenever one trace is not one row.
  const keyColumn = keyColumnOf(run);
  const table = rows.map((row) => {
    const traceId = typeof row.TraceId === "string" ? row.TraceId : "";
    const spanId = typeof row.SpanId === "string" ? row.SpanId : "";
    const key = typeof row[keyColumn] === "string" ? row[keyColumn] : traceId;
    const answers: Record<string, string> = {};
    for (const id of questionIds) {
      // A model-call run judges several spans of one trace, each with its own
      // verdict, so a row naming its span is matched on the span as well.
      const judgment = judgments.find(
        (one) =>
          one.traceId === traceId &&
          one.questionId === id &&
          (spanId === "" || one.spanId === spanId),
      );
      answers[id] = judgment ? verdictOf(judgment) : "";
    }
    return {
      [keyHeaderOf(keyColumn)]: shortKey(String(key)),
      ...answers,
      Text: preview(textOf(row), 58),
    };
  });

  console.log();
  formatTable({
    data: table,
    headers: [keyHeaderOf(keyColumn), ...questionIds, "Text"],
    emptyMessage: "No rows to show yet.",
  });
}

/** The column naming one row of this run. */
function keyColumnOf(run: InstantEvalRun): "ThreadId" | "SpanId" | "TraceId" {
  const sql = run.sql.toLowerCase();
  if (sql.includes("group by") && sql.includes("conversationid")) {
    return "ThreadId";
  }
  if (sql.includes("spanattributes['langwatch.span.type']")) return "SpanId";
  return "TraceId";
}

const KEY_HEADERS: Readonly<Record<string, string>> = {
  ThreadId: "Conversation",
  SpanId: "Span",
  TraceId: "Trace",
};

function keyHeaderOf(column: string): string {
  return KEY_HEADERS[column] ?? "Trace";
}

/**
 * Enough of a key to tell two rows apart. Cut from the end rather than the start: a production id
 * is random either way, and a prefixed one carries its distinguishing part last, so cutting the
 * front leaves every row looking the same.
 */
function shortKey(key: string): string {
  return key.length <= 20 ? key : `…${key.slice(-19)}`;
}

/** How a finished run ended, for the caller's exit code and its document. */
export type InstantEvalRunOutcome =
  | "finished"
  | "failed"
  | "cancelled"
  | "poll_failure"
  | "timeout";

export interface InstantEvalLiveResult {
  outcome: InstantEvalRunOutcome;
  run: InstantEvalRun;
  elapsedMs: number;
}

/**
 * Follow the run to its end, reporting progress in place while it goes. Reports nothing in a
 * machine format: stdout there carries one document, and a progress line written into it would not
 * parse.
 */
export async function followInstantEvalRun({
  service,
  run: created,
  machine,
  timeoutMs = DEFAULT_INSTANT_EVAL_FOLLOW_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
}: {
  service: Pick<InstantEvalsApiService, "get">;
  run: InstantEvalRun;
  machine: boolean;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<InstantEvalLiveResult> {
  const startedAt = now();
  const spinner = machine ? undefined : createSpinner(instantEvalProgressLine(created, 0)).start();

  let last = created;
  let failures = 0;

  for (;;) {
    if (isOver(last.status)) {
      spinner?.stop();
      return {
        outcome: last.status as InstantEvalRunOutcome,
        run: last,
        elapsedMs: now() - startedAt,
      };
    }

    if (now() - startedAt > timeoutMs) {
      spinner?.stop();
      return { outcome: "timeout", run: last, elapsedMs: now() - startedAt };
    }

    await sleep(POLL_INTERVAL_MS);

    try {
      last = await service.get(created.id);
      failures = 0;
    } catch {
      failures += 1;
      if (failures >= MAX_CONSECUTIVE_POLL_FAILURES) {
        spinner?.stop();
        return {
          outcome: "poll_failure",
          run: last,
          elapsedMs: now() - startedAt,
        };
      }
      continue;
    }

    if (spinner) {
      spinner.text = instantEvalProgressLine(last, now() - startedAt);
    }
  }
}

function isOver(status: InstantEvalRun["status"]): boolean {
  return status === "finished" || status === "failed" || status === "cancelled";
}
