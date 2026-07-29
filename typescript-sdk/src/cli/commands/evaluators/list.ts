import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { EvaluatorsApiService } from "@/client-sdk/services/evaluators";
import { checkApiKey } from "../../utils/apiKey";
import { formatTable, formatRelativeTime } from "../../utils/formatting";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the listing rather than printing it: the output port renders it in
 * whatever format the caller asked for (utils/output.ts). The `table` closure
 * is the human form, byte-identical to what this command printed before.
 */
export const listEvaluatorsCommand = async (): Promise<CommandResult | void> => {
  checkApiKey();

  const service = new EvaluatorsApiService();
  const spinner = createSpinner("Fetching evaluators...").start();

  let evaluators: Awaited<ReturnType<EvaluatorsApiService["getAll"]>>;
  try {
    evaluators = await service.getAll();

    spinner.succeed(
      `Found ${evaluators.length} evaluator${evaluators.length !== 1 ? "s" : ""}`,
    );
  } catch (error) {
    // No explicit `format`: see traces/search.ts — the preAction hook covers
    // every spelling; the `-f` commander default must not override it.
    failSpinner({ spinner, error, action: "fetch evaluators" });
    process.exit(1);
  }

  return {
    data: evaluators,
    table: () => {
      if (evaluators.length === 0) {
        console.log();
        console.log(chalk.gray("No evaluators found in this project."));
        console.log(chalk.gray("Create your first evaluator with:"));
        console.log(
          chalk.cyan('  langwatch evaluator create "My Evaluator" --type langevals/llm_boolean'),
        );
        console.log(
          chalk.gray(
            `Run ${chalk.cyan("langwatch evaluator types")} to list every valid type`,
          ),
        );
        return;
      }

      console.log();

      const tableData = evaluators.map((evaluator) => {
        const config = evaluator.config as
          | { evaluatorType?: string }
          | null
          | undefined;
        const evaluatorType = config?.evaluatorType ?? evaluator.type ?? "—";

        return {
          Name: evaluator.name,
          Slug: evaluator.slug ?? chalk.gray("—"),
          Type: evaluatorType,
          Updated: formatRelativeTime(evaluator.updatedAt),
        };
      });

      formatTable({
        data: tableData,
        headers: ["Name", "Slug", "Type", "Updated"],
        colorMap: {
          Name: chalk.cyan,
          Slug: chalk.green,
          Type: chalk.yellow,
        },
      });

      console.log();
      console.log(
        chalk.gray(
          `Use ${chalk.cyan("langwatch evaluator get <slug>")} to view evaluator details`,
        ),
      );
    },
  };
};
