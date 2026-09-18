/**
 * `langwatch instant-eval run`: ask one question of a whole history.
 *
 * The command runs the eval and answers with the result, the way any other
 * command does. It creates the run, shows the statement, the price and the
 * progress while the judging happens, and replaces all of it with the matches
 * when the run is done. `--detach` is the other shape: create it and return
 * the id, for a caller that will read it back later.
 *
 * It renders its own resolved format rather than returning a `CommandResult`,
 * because two things follow the answer: the estimate printed BEFORE a large
 * run is created, and the rows read after it finishes. A machine caller still
 * reads exactly one document, and the estimate goes to stderr so it never
 * lands inside it.
 *
 * ## Why a large run is priced first
 *
 * A run is charged for what it judges, and the difference between a hundred
 * rows and a hundred thousand is three orders of magnitude of spend for the
 * same command line. So above a thousand rows the command asks what it would
 * cost, says so, and then creates the run. `--estimate` stops after the price.
 *
 * @see specs/features/instant-eval-cli.feature
 */

import chalk from "chalk";

import type {
  InstantEvalEstimate,
  InstantEvalJudgment,
  InstantEvalRun,
  InstantEvalRunBody,
  InstantEvalsApiService,
} from "@/client-sdk/services/instant-evals";

import { resolveCredentials } from "../../utils/apiKey";
import {
  printResult,
  type RawOutputFlags,
  resolveOutputOptions,
} from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";
import { createCliInstantEvalsService } from "./cli-instant-evals-service";
import {
  DEFAULT_INSTANT_EVAL_SHOW_ROWS,
  followInstantEvalRun,
  INSTANT_EVAL_SHOW_CEILING,
  instantEvalHeadline,
  type InstantEvalRunOutcome,
  printInstantEvalRows,
} from "./liveRun";
import type { QuestionDraft } from "./questionFlags";
import { estimateLine, printEstimate, printRun, printStatement } from "./render";
import {
  buildInstantEvalRunBody,
  INSTANT_EVAL_ESTIMATE_FIRST_ROWS,
  type InstantEvalRunFlags,
} from "./runInput";

export interface InstantEvalRunOptions
  extends InstantEvalRunFlags,
    RawOutputFlags {
  estimate?: boolean;
  detach?: boolean;
  show?: string;
  /** Accepted and ignored: a run waits by default now. */
  wait?: boolean | string;
}

/** What the command answers with, whichever way the run ended. */
interface RunDocument {
  outcome: "created" | "estimated" | InstantEvalRunOutcome;
  run?: InstantEvalRun;
  estimate?: InstantEvalEstimate;
  /** The first page of matched judgements, for a caller reading one document. */
  judgments?: readonly InstantEvalJudgment[];
}

export const runInstantEvalCommand = async (
  instructions: string | undefined,
  options: InstantEvalRunOptions,
  drafts: readonly QuestionDraft[],
): Promise<void> => {
  await resolveCredentials();

  // Everything the line said is read before anything is sent, so a malformed
  // flag never leaves a run half-started.
  const body = await buildInstantEvalRunBody({
    ...(instructions === undefined ? {} : { instructions }),
    drafts,
    flags: options,
  });
  const resolved = resolveOutputOptions(options);
  const machine = resolved.format !== "table";
  const service = createCliInstantEvalsService();

  if (options.estimate) {
    await reportEstimate({ service, body, options });
    return;
  }

  const estimate = await priceIfLarge({ service, body, machine });
  const run = await createRun({ service, body, machine });

  if (options.detach) {
    await reportDetached({ run, estimate, options });
    return;
  }

  await followAndReport({ service, run, estimate, options, machine });
};

/** Create the run, or fail with the reason on the spinner. */
async function createRun({
  service,
  body,
  machine,
}: {
  service: InstantEvalsApiService;
  body: InstantEvalRunBody;
  machine: boolean;
}): Promise<InstantEvalRun> {
  const spinner = createSpinner("Starting the run...").start();
  try {
    const run = await service.create(body);
    spinner.stop();
    if (!machine) printStatement(run);
    return run;
  } catch (error) {
    failSpinner({ spinner, error, action: "start an instant eval run" });
    process.exit(1);
  }
}

/** `--detach`: the run id, and the command that reads it back. */
async function reportDetached({
  run,
  estimate,
  options,
}: {
  run: InstantEvalRun;
  estimate: InstantEvalEstimate | undefined;
  options: InstantEvalRunOptions;
}): Promise<void> {
  await printResult(
    { outcome: "created", run, ...(estimate ? { estimate } : {}) },
    {
      ...options,
      table: () => {
        printRun(run);
        console.log();
        console.log(
          chalk.gray(
            `Follow it with ${chalk.cyan(`langwatch instant-eval status ${run.id}`)}`,
          ),
        );
      },
    },
  );
}

/**
 * Follow the run to its end and print what it found.
 *
 * Ctrl-C leaves the run judging: it is already created and already being paid
 * for, so stopping the terminal is not a reason to throw the work away. The
 * command that reads it back is printed instead.
 */
async function followAndReport({
  service,
  run: created,
  estimate,
  options,
  machine,
}: {
  service: InstantEvalsApiService;
  run: InstantEvalRun;
  estimate: InstantEvalEstimate | undefined;
  options: InstantEvalRunOptions;
  machine: boolean;
}): Promise<void> {
  const onInterrupt = (): void => {
    if (!machine) {
      console.log();
      console.log(
        chalk.yellow(
          `The run is still going. Read it with ${chalk.cyan(
            `langwatch instant-eval status ${created.id}`,
          )}`,
        ),
      );
    }
    process.exit(0);
  };
  process.on("SIGINT", onInterrupt);

  try {
    const live = await followInstantEvalRun({
      service,
      run: created,
      machine,
    });
    const shown = await readRows({
      service,
      run: live.run,
      show: readShow(options.show),
    });

    if (live.outcome !== "finished") process.exitCode = 1;

    const document: RunDocument = {
      outcome: live.outcome,
      run: live.run,
      ...(estimate ? { estimate } : {}),
      judgments: shown.judgments,
    };
    await printResult(document, {
      ...options,
      table: () => {
        console.log();
        console.log(instantEvalHeadline(live.run, live.elapsedMs));
        printInstantEvalRows({
          rows: shown.rows,
          judgments: shown.judgments,
          run: live.run,
        });
        console.log();
        console.log(
          chalk.gray(
            live.outcome === "finished"
              ? `Read the rest with ${chalk.cyan(`langwatch instant-eval results ${live.run.id} --matched`)}`
              : `The run is ${live.run.status}. Read it with ${chalk.cyan(`langwatch instant-eval status ${live.run.id}`)}`,
          ),
        );
      },
    });
  } finally {
    process.off("SIGINT", onInterrupt);
  }
}

/** `--show N`, bounded by what one sample may re-read. */
function readShow(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_INSTANT_EVAL_SHOW_ROWS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    return DEFAULT_INSTANT_EVAL_SHOW_ROWS;
  }
  return Math.min(value, INSTANT_EVAL_SHOW_CEILING);
}

/**
 * The first rows of the finished run, matched ones first.
 *
 * A sample rather than a results page, because the table shows the text each
 * row was judged on beside its verdict, and only the sample re-reads that text
 * through the statement's own extraction functions. It judges nothing again.
 */
async function readRows({
  service,
  run,
  show,
}: {
  service: InstantEvalsApiService;
  run: InstantEvalRun;
  show: number;
}): Promise<{
  rows: readonly Record<string, unknown>[];
  judgments: readonly InstantEvalJudgment[];
}> {
  if (run.progress === 0) return { rows: [], judgments: [] };
  try {
    const sample = await service.sample(run.id, { n: show });
    return { rows: sample.rows, judgments: sample.judgments };
  } catch {
    // The run is the answer; the rows are what it found. Failing to read them
    // back must not turn a finished run into a failed command.
    return { rows: [], judgments: [] };
  }
}

/** `--estimate`: the price, and nothing created. */
async function reportEstimate({
  service,
  body,
  options,
}: {
  service: InstantEvalsApiService;
  body: InstantEvalRunBody;
  options: InstantEvalRunOptions;
}): Promise<void> {
  const spinner = createSpinner("Pricing the run...").start();
  let estimate: InstantEvalEstimate;
  try {
    estimate = await service.estimate(body);
  } catch (error) {
    failSpinner({ spinner, error, action: "estimate an instant eval run" });
    process.exit(1);
  }
  spinner.succeed(estimateLine(estimate));

  await printResult(
    { outcome: "estimated", estimate },
    { ...options, table: () => printEstimate(estimate) },
  );
}

/**
 * The estimate a plain run prints before it creates anything, or nothing.
 *
 * Only asked for above the row threshold: a small run is not worth a second
 * round trip, and the whole point of the threshold is that the caller sees a
 * price before a spend that is worth seeing. A failed estimate does not stop
 * the run, because the caller asked for a run and not for a price, so it is
 * reported on stderr and the run goes ahead.
 */
async function priceIfLarge({
  service,
  body,
  machine,
}: {
  service: InstantEvalsApiService;
  body: InstantEvalRunBody;
  machine: boolean;
}): Promise<InstantEvalEstimate | undefined> {
  const limit = (body as { limit?: number }).limit;
  if (limit === undefined || limit <= INSTANT_EVAL_ESTIMATE_FIRST_ROWS) {
    return undefined;
  }

  const spinner = createSpinner("Pricing the run...").start();
  try {
    const estimate = await service.estimate(body);
    spinner.succeed(`This run will judge ${estimateLine(estimate)}`);
    if (!machine) {
      console.log(
        chalk.gray(
          "  Run it with --estimate to see the price without starting it.",
        ),
      );
    }
    return estimate;
  } catch {
    spinner.warn(
      "Could not price the run first. Starting it anyway; read the price back on the run.",
    );
    return undefined;
  }
}
