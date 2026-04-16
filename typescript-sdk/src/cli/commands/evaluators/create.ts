import chalk from "chalk";
import ora from "ora";
import {
  EvaluatorsApiService,
  EvaluatorsApiError,
} from "@/client-sdk/services/evaluators";
import { checkApiKey } from "../../utils/apiKey";

export const createEvaluatorCommand = async (
  name: string,
  options: { type: string; format?: string },
): Promise<void> => {
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

    if (options.format === "json") {
      console.log(JSON.stringify(evaluator, null, 2));
    } else if (evaluator.platformUrl) {
      console.log(`  ${chalk.bold("View:")}  ${chalk.underline(evaluator.platformUrl)}`);
    }
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
};
