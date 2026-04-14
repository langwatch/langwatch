import chalk from "chalk";
import ora from "ora";
import {
  EvaluatorsApiService,
  EvaluatorsApiError,
} from "@/client-sdk/services/evaluators";
import type { UpdateEvaluatorBody } from "@/client-sdk/services/evaluators";
import { checkApiKey } from "../../utils/apiKey";

export const updateEvaluatorCommand = async (
  idOrSlug: string,
  options: { name?: string; settings?: string; format?: string },
): Promise<void> => {
  checkApiKey();

  const service = new EvaluatorsApiService();

  // First resolve the evaluator to get its ID
  const resolveSpinner = ora(`Finding evaluator "${idOrSlug}"...`).start();

  let evaluatorId: string;
  try {
    const evaluator = await service.get(idOrSlug);
    evaluatorId = evaluator.id;
    resolveSpinner.succeed(`Found evaluator "${evaluator.name}"`);
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

  const updateSpinner = ora(`Updating evaluator...`).start();

  try {
    const body: UpdateEvaluatorBody = {};
    if (options.name !== undefined) body.name = options.name;
    if (options.settings !== undefined) {
      body.config = JSON.parse(options.settings) as Record<string, unknown>;
    }

    const updated = await service.update(evaluatorId, body);

    updateSpinner.succeed(
      `Updated evaluator "${chalk.cyan(updated.name)}" ${chalk.gray(`(slug: ${updated.slug ?? "—"})`)}`,
    );

    if (options.format === "json") {
      console.log(JSON.stringify(updated, null, 2));
    }
  } catch (error) {
    updateSpinner.fail();
    if (error instanceof SyntaxError) {
      console.error(chalk.red("Error: --settings must be valid JSON"));
    } else if (error instanceof EvaluatorsApiError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error updating evaluator: ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      );
    }
    process.exit(1);
  }
};
