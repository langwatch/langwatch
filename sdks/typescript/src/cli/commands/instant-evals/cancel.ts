/**
 * `langwatch instant-eval cancel <id>`: ask a run to stop before its next page; pages already
 * judged keep their judgements and stay readable.
 * @see specs/features/instant-eval-cli.feature
 */

import chalk from "chalk";

import { resolveCredentials } from "../../utils/apiKey";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";
import { createCliInstantEvalsService } from "./cli-instant-evals-service";
import { printRun } from "./render";

export const cancelInstantEvalCommand = async (id: string): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = createCliInstantEvalsService();
  const spinner = createSpinner(`Cancelling run ${id}...`).start();

  try {
    const run = await service.cancel(id);

    spinner.succeed(`Run ${run.id} was asked to stop`);

    return {
      data: run,
      table: () => {
        printRun(run);
        console.log();
        console.log(
          chalk.gray(
            `The rows it already judged are still readable with ${chalk.cyan(`langwatch instant-eval results ${run.id}`)}`,
          ),
        );
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "cancel an instant eval run" });
    process.exit(1);
  }
};
