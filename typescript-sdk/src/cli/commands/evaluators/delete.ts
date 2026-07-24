import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { EvaluatorsApiService } from "@/client-sdk/services/evaluators";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the archival outcome rather than printing it: the output port renders
 * it in whatever format the caller asked for (utils/output.ts).
 */
export const deleteEvaluatorCommand = async (
  idOrSlug: string,
): Promise<CommandResult | void> => {
  checkApiKey();

  const service = new EvaluatorsApiService();

  const resolveSpinner = createSpinner(`Finding evaluator "${idOrSlug}"...`).start();

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

  const deleteSpinner = createSpinner(`Archiving evaluator "${evaluatorName}"...`).start();

  try {
    await service.delete(evaluatorId);
    deleteSpinner.succeed(
      `Archived evaluator "${chalk.cyan(evaluatorName)}"`,
    );
  } catch (error) {
    failSpinner({
      spinner: deleteSpinner,
      error,
      action: `archive evaluator "${evaluatorName}"`,
    });
    process.exit(1);
  }

  return {
    data: { id: evaluatorId, name: evaluatorName, archived: true },
    table: () => {
      // The spinner's success line is the human output.
    },
  };
};
