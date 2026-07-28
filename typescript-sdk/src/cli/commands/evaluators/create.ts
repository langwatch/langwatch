import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { EvaluatorsApiService } from "@/client-sdk/services/evaluators";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import {
  commandValidationError,
  reportCommandError,
} from "../../utils/errorOutput";
import type { CommandResult } from "../../utils/output";
import { closestEvaluatorTypes, isValidEvaluatorType } from "./catalog";

/**
 * Returns the created evaluator rather than printing it: the output port
 * renders it in whatever format the caller asked for (utils/output.ts).
 */
export const createEvaluatorCommand = async (
  name: string,
  options: { type: string },
): Promise<CommandResult | void> => {
  // A type slug the platform would reject fails HERE, before any network
  // round-trip, with the closest real slugs in the message and the same
  // reason shape the server's 422 carries (meta.field / expected / received)
  // — so a human and an agent both read one shape wherever the miss is caught.
  if (!isValidEvaluatorType(options.type)) {
    const closest = closestEvaluatorTypes(options.type);
    reportCommandError({
      error: {
        ...commandValidationError(
          `Unknown evaluator type "${options.type}". Closest matches: ${closest.join(", ")}. Run \`langwatch evaluator types\` for the full list.`,
          { fields: ["type"] },
        ),
        reasons: [
          {
            kind: "schema_failure",
            meta: {
              field: "type",
              expected: closest,
              received: options.type,
            },
          },
        ],
      },
    });
    process.exit(1);
  }

  checkApiKey();

  const service = new EvaluatorsApiService();
  const spinner = createSpinner(`Creating evaluator "${name}"...`).start();

  let evaluator: Awaited<ReturnType<EvaluatorsApiService["create"]>>;
  try {
    evaluator = await service.create({
      name,
      config: {
        evaluatorType: options.type,
      },
    });

    spinner.succeed(
      `Created evaluator "${chalk.cyan(evaluator.name)}" ${chalk.gray(`(slug: ${evaluator.slug ?? "—"})`)}`,
    );
  } catch (error) {
    // No explicit `format`: see traces/search.ts — the preAction hook covers
    // every spelling; the `-f` commander default must not override it.
    failSpinner({ spinner, error, action: "create evaluator" });
    process.exit(1);
  }

  return {
    data: evaluator,
    table: () => {
      if (evaluator.platformUrl) {
        console.log(`  ${chalk.bold("View:")}  ${chalk.underline(evaluator.platformUrl)}`);
      }
    },
  };
};
