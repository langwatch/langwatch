import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { EvaluatorsApiService } from "@/client-sdk/services/evaluators";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import { printResult, type RawOutputFlags } from "../../utils/output";

export const createEvaluatorCommand = async (
  name: string,
  options: { type: string } & RawOutputFlags,
): Promise<void> => {
  checkApiKey();

  const service = new EvaluatorsApiService();
  const spinner = createSpinner(`Creating evaluator "${name}"...`).start();

  try {
    const evaluator = await service.create({
      name,
      config: {
        evaluatorType: options.type,
      },
    });

    spinner.succeed(
      `Created evaluator "${chalk.cyan(evaluator.name)}" ${chalk.gray(`(slug: ${evaluator.slug ?? "—"})`)}`,
    );

    await printResult(evaluator, {
      ...options,
      table: () => {
        if (evaluator.platformUrl) {
          console.log(`  ${chalk.bold("View:")}  ${chalk.underline(evaluator.platformUrl)}`);
        }
      },
    });
  } catch (error) {
    // No explicit `format`: see traces/search.ts — the preAction hook covers
    // every spelling; the `-f` commander default must not override it.
    failSpinner({ spinner, error, action: "create evaluator" });
    process.exit(1);
  }
};
