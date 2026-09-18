/**
 * `langwatch instant-eval run` — ask one question of a whole history.
 *
 * Renders its own resolved format rather than returning a `CommandResult`,
 * because two things follow the answer: the estimate that is printed BEFORE a
 * large run is created, and the `--wait` poll that runs after. A machine
 * caller still reads exactly one document, and the estimate line goes to
 * stderr so it never lands inside it.
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
import type { QuestionDraft } from "./questionFlags";
import { estimateLine, printEstimate, printRun, printStatement } from "./render";
import {
  buildInstantEvalRunBody,
  INSTANT_EVAL_ESTIMATE_FIRST_ROWS,
  type InstantEvalRunFlags,
} from "./runInput";
import {
  type InstantEvalWaitOutcome,
  readWaitMinutes,
  waitForInstantEvalRun,
} from "./waitForInstantEvalRun";

export interface InstantEvalRunOptions
  extends InstantEvalRunFlags,
    RawOutputFlags {
  estimate?: boolean;
  wait?: boolean | string;
}

/** What the command answers with, whichever way the run ended. */
interface RunDocument {
  outcome: "created" | "estimated" | InstantEvalWaitOutcome;
  run?: InstantEvalRun;
  estimate?: InstantEvalEstimate;
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
  const spinner = createSpinner("Starting the run...").start();
  let run: InstantEvalRun;
  try {
    run = await service.create(body);
  } catch (error) {
    failSpinner({ spinner, error, action: "start an instant eval run" });
    process.exit(1);
  }
  spinner.succeed(`Run ${run.id} queued`);

  const minutes = readWaitMinutes(options.wait);
  if (minutes === undefined) {
    await printResult(
      { outcome: "created", run, ...(estimate ? { estimate } : {}) },
      {
        ...options,
        table: () => {
          printRun(run);
          printStatement(run);
          console.log();
          console.log(
            chalk.gray(
              `Follow it with ${chalk.cyan(`langwatch instant-eval status ${run.id} --wait`)}`,
            ),
          );
        },
      },
    );
    return;
  }

  const waited = await waitForInstantEvalRun({
    service,
    runId: run.id,
    machine,
    timeoutMs: minutes * 60_000,
  });
  const document: RunDocument = {
    outcome: waited.outcome,
    run: waited.run,
    ...(estimate ? { estimate } : {}),
  };
  await printResult(document, {
    ...options,
    table: () => {
      printRun(waited.run);
      printStatement(waited.run);
      console.log();
      console.log(
        chalk.gray(
          `Read the matches with ${chalk.cyan(`langwatch instant-eval results ${run.id} --matched`)}`,
        ),
      );
    },
  });
};

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
 * the run — the caller asked for a run, not for a price — so it is reported on
 * stderr and the run goes ahead.
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
