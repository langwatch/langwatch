import chalk from "chalk";
import ora from "ora";
import { EvaluatorsApiService } from "@/client-sdk/services/evaluators";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

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
    failSpinner({
      spinner: resolveSpinner,
      error,
      action: `find evaluator "${idOrSlug}"`,
    });
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
    failSpinner({
      spinner: deleteSpinner,
      error,
      action: `archive evaluator "${evaluatorName}"`,
    });
    process.exit(1);
  }
};
