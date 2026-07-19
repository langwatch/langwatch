import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { EvaluatorsApiService } from "@/client-sdk/services/evaluators";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import { printResult, type RawOutputFlags } from "../../utils/output";

export const deleteEvaluatorCommand = async (
  idOrSlug: string,
  options?: RawOutputFlags,
): Promise<void> => {
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

  // Rendering stays OUTSIDE the deletion try: a printResult rejection (invalid
  // --jq) must not report an already-archived evaluator as an archive failure.
  await printResult(
    { id: evaluatorId, name: evaluatorName, archived: true },
    {
      ...options,
      table: () => {
        // The spinner's success line is the human output.
      },
    },
  );
};
