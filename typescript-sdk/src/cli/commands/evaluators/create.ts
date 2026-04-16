import chalk from "chalk";
import ora from "ora";
import { EvaluatorsApiService } from "@/client-sdk/services/evaluators";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

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
    failSpinner({ spinner, error, action: "create evaluator" });
    process.exit(1);
  }
};
