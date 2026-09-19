/**
 * How a run, an estimate and a judgement read on a terminal.
 *
 * One module because six commands print the same four things, and a run that
 * reads one way under `run` and another under `status` is worse than either.
 *
 * The statement is printed under its own heading on purpose: a caller who
 * asked a question with `--target` gets back the LangWatchQL that answers it,
 * which is what they edit when the shorthand is not enough. In a machine
 * format it is already a field of the run, so it is not printed twice.
 *
 * @see specs/features/instant-eval-cli.feature
 */

import chalk from "chalk";

import type {
  InstantEvalEstimate,
  InstantEvalJudgment,
  InstantEvalRun,
} from "@/client-sdk/services/instant-evals";

import { formatTable } from "../../utils/formatting";

/** "3,200". */
const grouped = (value: number): string => value.toLocaleString("en-US");

/** A price, in as many decimals as it takes to not read as free. */
export function money(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

const STATUS_COLOR: Readonly<
  Record<InstantEvalRun["status"], (text: string) => string>
> = {
  queued: chalk.gray,
  planning: chalk.gray,
  running: chalk.cyan,
  finished: chalk.green,
  failed: chalk.red,
  cancelled: chalk.yellow,
};

/** The run's status, coloured for what it means. */
export function statusLabel(run: InstantEvalRun): string {
  return (STATUS_COLOR[run.status] ?? chalk.white)(run.status);
}

/** The statement, under a heading, so a reader learns the query behind it. */
export function printStatement(run: InstantEvalRun): void {
  console.log();
  console.log(chalk.bold("  Statement:"));
  for (const line of run.sql.split("\n")) {
    console.log(`    ${chalk.gray(line)}`);
  }
  const names = Object.keys(run.parameters ?? {});
  if (names.length > 0) {
    console.log();
    console.log(chalk.bold("  Parameters:"));
    for (const name of names) {
      console.log(
        `    ${chalk.gray(`${name}:`)} ${String(run.parameters[name] ?? "")}`,
      );
    }
  }
}

/** One run, as `run`, `status` and `cancel` all print it. */
export function printRun(run: InstantEvalRun): void {
  console.log();
  console.log(chalk.bold("  Instant Eval run:"));
  console.log(`    ${chalk.gray("ID:")}       ${chalk.green(run.id)}`);
  if (run.name) {
    console.log(`    ${chalk.gray("Name:")}     ${chalk.cyan(run.name)}`);
  }
  console.log(`    ${chalk.gray("Status:")}   ${statusLabel(run)}`);
  console.log(
    `    ${chalk.gray("Rows:")}     ${grouped(run.progress)}/${grouped(run.total ?? run.limit)}`,
  );
  if (run.matched !== null) {
    console.log(`    ${chalk.gray("Matched:")}  ${grouped(run.matched)}`);
  }
  if (run.failed > 0 || run.skipped > 0) {
    console.log(
      `    ${chalk.gray("Unjudged:")} ${grouped(run.failed)} failed, ${grouped(run.skipped)} skipped`,
    );
  }
  console.log(
    `    ${chalk.gray("Tokens:")}   ${grouped(run.tokens)}  ${chalk.gray("Price:")} ${money(run.priceUsd)}`,
  );
  if (run.error) {
    console.log(`    ${chalk.gray("Error:")}    ${chalk.red(run.error)}`);
  }

  console.log();
  console.log(chalk.bold("  Questions:"));
  for (const question of run.questions) {
    const threshold =
      question.threshold === null ? "" : ` at ${question.threshold}`;
    console.log(
      `    ${chalk.gray("•")} ${chalk.cyan(question.id)} ${chalk.gray(`${question.kind} via ${question.function}${threshold}`)}`,
    );
  }
  if (Object.keys(run.matchedByQuestion ?? {}).length > 0) {
    console.log();
    console.log(chalk.bold("  Per question:"));
    for (const [id, count] of Object.entries(run.matchedByQuestion)) {
      console.log(`    ${chalk.gray(`${id}:`)} ${grouped(count)}`);
    }
  }
}

/** The one line a plain `run` prints before it spends anything. */
export function estimateLine(estimate: InstantEvalEstimate): string {
  return (
    `${grouped(estimate.rows)} row${estimate.rows === 1 ? "" : "s"}, ` +
    `${grouped(estimate.totalTokens)} tokens, ${money(estimate.priceUsd)}`
  );
}

/** The estimate, as `estimate` and `run --estimate` print it. */
export function printEstimate(estimate: InstantEvalEstimate): void {
  console.log();
  console.log(chalk.bold("  This run would judge:"));
  console.log(
    `    ${chalk.gray("Rows:")}     ${grouped(estimate.rows)}${estimate.isRowsCapped ? chalk.yellow(" (capped by --limit)") : ""}`,
  );
  console.log(
    `    ${chalk.gray("Requests:")} ${grouped(estimate.requests)}  ${chalk.gray("Tokens:")} ${grouped(estimate.totalTokens)} (${grouped(estimate.avgTokens)} per row)`,
  );
  console.log(`    ${chalk.gray("Price:")}    ${chalk.cyan(money(estimate.priceUsd))}`);
  console.log();
  console.log(chalk.gray("  Nothing was judged and nothing was charged."));
}

/** The project's runs, newest first. */
export function printRunList(runs: readonly InstantEvalRun[]): void {
  if (runs.length === 0) {
    console.log();
    console.log(chalk.gray("No Instant Eval runs in this project yet."));
    console.log(chalk.gray("Start one with:"));
    console.log(
      chalk.cyan(
        '  langwatch instant-eval run "the customer sounds annoyed" --target threads --last 7d',
      ),
    );
    return;
  }

  console.log();
  formatTable({
    data: runs.map((run) => ({
      ID: run.id,
      Name: run.name ?? "",
      Status: run.status,
      Rows: `${grouped(run.progress)}/${grouped(run.total ?? run.limit)}`,
      Matched: run.matched === null ? "" : grouped(run.matched),
      Price: money(run.priceUsd),
      Started: run.createdAt,
    })),
    headers: ["ID", "Name", "Status", "Rows", "Matched", "Price", "Started"],
    colorMap: { ID: chalk.green, Name: chalk.cyan },
  });
}

/** What one judgement answered, whichever kind of question it was. */
function verdictOf(judgment: InstantEvalJudgment): string {
  if (judgment.status !== "judged") return judgment.error ?? judgment.status;
  if (judgment.label !== null) {
    return judgment.probability === null
      ? judgment.label
      : `${judgment.label} (${judgment.probability.toFixed(2)})`;
  }
  if (judgment.score !== null) return judgment.score.toFixed(2);
  if (judgment.passed !== null) {
    const probability =
      judgment.probability === null
        ? ""
        : ` (${judgment.probability.toFixed(2)})`;
    return `${judgment.passed ? "yes" : "no"}${probability}`;
  }
  return judgment.probability === null ? "" : judgment.probability.toFixed(2);
}

/** One page of judgements. */
export function printJudgments({
  judgments,
  nextCursor,
}: {
  judgments: readonly InstantEvalJudgment[];
  nextCursor?: string;
}): void {
  if (judgments.length === 0) {
    console.log();
    console.log(chalk.gray("No judgements matched."));
    return;
  }

  console.log();
  formatTable({
    data: judgments.map((judgment) => ({
      Trace: judgment.traceId,
      Question: judgment.questionId,
      Status: judgment.status,
      Answer: verdictOf(judgment),
      Thread: judgment.threadId,
    })),
    headers: ["Trace", "Question", "Status", "Answer", "Thread"],
    colorMap: { Trace: chalk.green, Question: chalk.cyan },
  });

  if (nextCursor) {
    console.log();
    console.log(
      chalk.gray(`Next page: ${chalk.cyan(`--cursor ${nextCursor}`)}`),
    );
  }
}

/** The longest a sampled text is printed before it is cut. */
const SAMPLE_TEXT_LIMIT = 2_000;

/** A few rows with the text that was judged beside the verdict it received. */
export function printSample({
  rows,
  judgments,
}: {
  rows: readonly Record<string, unknown>[];
  judgments: readonly InstantEvalJudgment[];
}): void {
  if (rows.length === 0) {
    console.log();
    console.log(chalk.gray("This run has no rows to sample yet."));
    return;
  }

  for (const row of rows) {
    const traceId = typeof row.TraceId === "string" ? row.TraceId : "";
    console.log();
    console.log(`  ${chalk.bold("Trace")} ${chalk.green(traceId)}`);
    for (const judgment of judgments.filter(
      (one) => one.traceId === traceId,
    )) {
      console.log(
        `    ${chalk.cyan(judgment.questionId)}: ${verdictOf(judgment)}`,
      );
      const text = row[judgment.questionId];
      if (typeof text !== "string" || text === "") continue;
      const shown =
        text.length > SAMPLE_TEXT_LIMIT
          ? `${text.slice(0, SAMPLE_TEXT_LIMIT)}\n    […]`
          : text;
      for (const line of shown.split("\n")) {
        console.log(`      ${chalk.gray(line)}`);
      }
      // Every question of one row judged the same text, so it is printed once.
      break;
    }
  }
}
