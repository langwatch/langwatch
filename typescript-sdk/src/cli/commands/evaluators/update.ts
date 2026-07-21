import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { EvaluatorsApiService } from "@/client-sdk/services/evaluators";
import type { EvaluatorResponse, UpdateEvaluatorBody } from "@/client-sdk/services/evaluators";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import { commandValidationError } from "../../utils/errorOutput";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the updated evaluator rather than printing it: the output port
 * renders it in whatever format the caller asked for (utils/output.ts).
 */
export const updateEvaluatorCommand = async (
  idOrSlug: string,
  options: { name?: string; settings?: string },
): Promise<CommandResult | void> => {
  checkApiKey();

  const service = new EvaluatorsApiService();

  const resolveSpinner = createSpinner(`Finding evaluator "${idOrSlug}"...`).start();

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

  const updateSpinner = createSpinner(`Updating evaluator...`).start();

  let updated: EvaluatorResponse;
  try {
    const body: UpdateEvaluatorBody = {};
    if (options.name !== undefined) body.name = options.name;
    if (options.settings !== undefined) {
      body.config = JSON.parse(options.settings) as Record<string, unknown>;
    }

    updated = await service.update(evaluatorId, body);

    updateSpinner.succeed(
      `Updated evaluator "${chalk.cyan(updated.name)}" ${chalk.gray(`(slug: ${updated.slug ?? "—"})`)}`,
    );
  } catch (error) {
    // Route BOTH failure kinds through failSpinner: a direct spinner.fail()
    // prints nothing in --json/--jq/agent mode (spinners are silent there),
    // so an invalid --settings would exit 1 with no machine-readable error.
    // No explicit `format`: see traces/search.ts — the preAction hook covers
    // every spelling; the `-f` commander default must not override it.
    failSpinner({
      spinner: updateSpinner,
      error:
        error instanceof SyntaxError
          ? commandValidationError("--settings must be valid JSON")
          : error,
      action: "update evaluator",
    });
    process.exit(1);
  }

  return {
    data: updated,
    table: () => {
      // The spinner's success line is the human output.
    },
  };
};
