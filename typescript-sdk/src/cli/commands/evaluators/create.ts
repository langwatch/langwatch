import chalk from "chalk";
import ora from "ora";
import {
  EvaluatorsApiService,
  EvaluatorsApiError,
} from "@/client-sdk/services/evaluators";
import { checkApiKey } from "../../utils/apiKey";

export const createEvaluatorCommand = async (
  name: string,
  options: { type: string },
): Promise<void> => {
  try {
    checkApiKey();

    const service = new EvaluatorsApiService();
    const spinner = ora(`Creating evaluator "${name}"...`).start();

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
    } catch (error) {
      spinner.fail();
      if (error instanceof EvaluatorsApiError) {
        console.error(chalk.red(`Error: ${error.message}`));
      } else {
        console.error(
          chalk.red(
            `Error creating evaluator: ${error instanceof Error ? error.message : "Unknown error"}`,
          ),
        );
      }
      process.exit(1);
    }
  } catch (error) {
    if (error instanceof EvaluatorsApiError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Unexpected error: ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      );
    }
    process.exit(1);
  }
};
