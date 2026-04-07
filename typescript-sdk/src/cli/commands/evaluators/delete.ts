import chalk from "chalk";
import ora from "ora";
import {
  EvaluatorsApiService,
  EvaluatorsApiError,
} from "@/client-sdk/services/evaluators";
import { checkApiKey } from "../../utils/apiKey";

export const deleteEvaluatorCommand = async (
  idOrSlug: string,
): Promise<void> => {
  try {
    checkApiKey();

    const service = new EvaluatorsApiService();

    // First resolve the evaluator to get its ID and name
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
            `Error finding evaluator: ${error instanceof Error ? error.message : "Unknown error"}`,
          ),
        );
      }
      process.exit(1);
    }

    // Delete uses ID, not slug
    const deleteSpinner = ora(`Archiving evaluator "${evaluatorName}"...`).start();

    try {
      await service.delete(evaluatorId);
      deleteSpinner.succeed(
        `Archived evaluator "${chalk.cyan(evaluatorName)}"`,
      );
    } catch (error) {
      deleteSpinner.fail();
      if (error instanceof EvaluatorsApiError) {
        console.error(chalk.red(`Error: ${error.message}`));
      } else {
        console.error(
          chalk.red(
            `Error archiving evaluator: ${error instanceof Error ? error.message : "Unknown error"}`,
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
