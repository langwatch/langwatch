/**
 * `langwatch instant-eval list`: the project's runs, newest first.
 *
 * @see specs/features/instant-eval-cli.feature
 */

import chalk from "chalk";

import { resolveCredentials } from "../../utils/apiKey";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";
import { createCliInstantEvalsService } from "./cli-instant-evals-service";
import { printRunList } from "./render";
import {
  INSTANT_EVAL_LIST_CEILING,
  readCountFlag,
} from "./countFlag";

export const listInstantEvalsCommand = async (options: {
  limit?: string;
  before?: string;
  beforeId?: string;
}): Promise<CommandResult | void> => {
  await resolveCredentials();

  const limit = readCountFlag({
    raw: options.limit,
    flag: "--limit",
    max: INSTANT_EVAL_LIST_CEILING,
  });
  const service = createCliInstantEvalsService();
  const spinner = createSpinner("Fetching Instant Eval runs...").start();

  try {
    const runs = await service.list({
      ...(limit === undefined ? {} : { limit }),
      ...(options.before === undefined ? {} : { before: options.before }),
      ...(options.beforeId === undefined
        ? {}
        : { beforeId: options.beforeId }),
    });

    spinner.succeed(`Found ${runs.length} run${runs.length === 1 ? "" : "s"}`);

    return {
      data: runs,
      table: () => {
        printRunList(runs);
        if (runs.length > 0) {
          console.log();
          console.log(
            chalk.gray(
              `Read one with ${chalk.cyan("langwatch instant-eval status <id>")}`,
            ),
          );
        }
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "list instant eval runs" });
    process.exit(1);
  }
};
