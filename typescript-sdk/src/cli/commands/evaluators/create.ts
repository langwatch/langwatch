import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { EvaluatorsApiService } from "@/client-sdk/services/evaluators";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the created evaluator rather than printing it: the output port
 * renders it in whatever format the caller asked for (utils/output.ts).
 */
export const createEvaluatorCommand = async (
  name: string,
  options: { type: string },
): Promise<CommandResult | void> => {
  checkApiKey();

  const service = new EvaluatorsApiService();
  const spinner = createSpinner(`Creating evaluator "${name}"...`).start();

  let evaluator: Awaited<ReturnType<EvaluatorsApiService["create"]>>;
  try {
    evaluator = await service.create({
      name,
      config: {
        evaluatorType: options.type,
      },
    });

    spinner.succeed(
      `Created evaluator "${chalk.cyan(evaluator.name)}" ${chalk.gray(`(slug: ${evaluator.slug ?? "—"})`)}`,
    );
  } catch (error) {
    // No explicit `format`: see traces/search.ts — the preAction hook covers
    // every spelling; the `-f` commander default must not override it.
    failSpinner({ spinner, error, action: "create evaluator" });
    process.exit(1);
  }

  return {
    data: evaluator,
    table: () => {
      if (evaluator.platformUrl) {
        console.log(`  ${chalk.bold("View:")}  ${chalk.underline(evaluator.platformUrl)}`);
      }
    },
  };
};
