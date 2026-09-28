/**
 * `langwatch instant-eval status <id>`: where one run is, and optionally
 * waiting there until it is done.
 *
 * Renders its own resolved format because `--wait` follows the answer, the
 * same reason `run` does.
 *
 * @see specs/features/instant-eval-cli.feature
 */

import chalk from "chalk";

import type { InstantEvalRun } from "@/client-sdk/services/instant-evals";

import { resolveCredentials } from "../../utils/apiKey";
import {
  printResult,
  type RawOutputFlags,
  resolveOutputOptions,
} from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";
import { createCliInstantEvalsService } from "./cli-instant-evals-service";
import { printRun, printStatement } from "./render";
import { readWaitMinutes, waitForInstantEvalRun } from "./waitForInstantEvalRun";

export const statusInstantEvalCommand = async (
  id: string,
  options: RawOutputFlags & { wait?: boolean | string; statement?: boolean },
): Promise<void> => {
  await resolveCredentials();

  const service = createCliInstantEvalsService();
  const resolved = resolveOutputOptions(options);
  const machine = resolved.format !== "table";
  const spinner = createSpinner(`Reading run ${id}...`).start();

  let run: InstantEvalRun;
  try {
    run = await service.get(id);
  } catch (error) {
    failSpinner({ spinner, error, action: "read an instant eval run" });
    process.exit(1);
  }
  spinner.succeed(`Run ${run.id} is ${run.status}`);

  const minutes = readWaitMinutes(options.wait);
  const finished =
    minutes === undefined
      ? run
      : (
          await waitForInstantEvalRun({
            service,
            runId: run.id,
            machine,
            timeoutMs: minutes * 60_000,
            known: run,
          })
        ).run;

  await printResult(finished, {
    ...options,
    table: () => {
      printRun(finished);
      printStatement(finished);
      if (finished.status === "finished") {
        console.log();
        console.log(
          chalk.gray(
            `Read the matches with ${chalk.cyan(`langwatch instant-eval results ${finished.id} --matched`)}`,
          ),
        );
      }
    },
  });
};
