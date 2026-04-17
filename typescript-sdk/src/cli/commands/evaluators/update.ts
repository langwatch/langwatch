import chalk from "chalk";
import ora from "ora";
import { EvaluatorsApiService } from "@/client-sdk/services/evaluators";
import type { UpdateEvaluatorBody } from "@/client-sdk/services/evaluators";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

export const updateEvaluatorCommand = async (
  idOrSlug: string,
  options: { name?: string; settings?: string; format?: string },
): Promise<void> => {
  checkApiKey();

  const service = new EvaluatorsApiService();

  const resolveSpinner = ora(`Finding evaluator "${idOrSlug}"...`).start();

  let evaluatorId: string;
  try {
    const evaluator = await service.get(idOrSlug);
    evaluatorId = evaluator.id;
    resolveSpinner.succeed(`Found evaluator "${evaluator.name}"`);
  } catch (error) {
    failSpinner({
      spinner: resolveSpinner,
      error,
      action: `find evaluator "${idOrSlug}"`,
    });
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
    if (error instanceof SyntaxError) {
      updateSpinner.fail(chalk.red("--settings must be valid JSON"));
    } else {
      failSpinner({ spinner: updateSpinner, error, action: "update evaluator" });
    }
    process.exit(1);
  }
};
