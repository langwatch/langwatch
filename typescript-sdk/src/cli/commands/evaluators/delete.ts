import chalk from "chalk";
import ora from "ora";
import {
  EvaluatorsApiService,
  EvaluatorsApiError,
} from "@/client-sdk/services/evaluators";
import { checkApiKey } from "../../utils/apiKey";
import { formatApiErrorMessage } from "@/client-sdk/services/_shared/format-api-error";

export const deleteEvaluatorCommand = async (
  idOrSlug: string,
  options?: { format?: string },
): Promise<void> => {
  checkApiKey();

  const service = new EvaluatorsApiService();

  const resolveSpinner = ora(`Finding evaluator "${idOrSlug}"...`).start();

  let evaluatorId: string;
  let evaluatorName: string;
  try {
    const evaluator = await service.get(idOrSlug);
    evaluatorId = evaluator.id;
    evaluatorName = evaluator.name;
    resolveSpinner.succeed(`Found evaluator "${evaluatorName}"`);
  } catch (error) {
    resolveSpinner.fail();
    if (error instanceof EvaluatorsApiError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error finding evaluator: ${formatApiErrorMessage({ error })}`,
        ),
      );
    }
    process.exit(1);
  }

  const deleteSpinner = ora(`Archiving evaluator "${evaluatorName}"...`).start();

  try {
    await service.delete(evaluatorId);
    deleteSpinner.succeed(
      `Archived evaluator "${chalk.cyan(evaluatorName)}"`,
    );

    if (options?.format === "json") {
      console.log(JSON.stringify({ id: evaluatorId, name: evaluatorName, archived: true }, null, 2));
    }
  } catch (error) {
    deleteSpinner.fail();
    if (error instanceof EvaluatorsApiError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error archiving evaluator: ${formatApiErrorMessage({ error })}`,
        ),
      );
    }
    process.exit(1);
  }
};
