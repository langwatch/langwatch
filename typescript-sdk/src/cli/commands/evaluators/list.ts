import chalk from "chalk";
import ora from "ora";
import {
  EvaluatorsApiService,
  EvaluatorsApiError,
} from "@/client-sdk/services/evaluators";
import { checkApiKey } from "../../utils/apiKey";
import { formatTable, formatRelativeTime } from "../../utils/formatting";

export const listEvaluatorsCommand = async (): Promise<void> => {
  checkApiKey();

  const service = new EvaluatorsApiService();
  const spinner = ora("Fetching evaluators...").start();

  try {
    const evaluators = await service.getAll();

    spinner.succeed(
      `Found ${evaluators.length} evaluator${evaluators.length !== 1 ? "s" : ""}`,
    );

    if (evaluators.length === 0) {
      console.log();
      console.log(chalk.gray("No evaluators found in this project."));
      console.log(chalk.gray("Create your first evaluator with:"));
      console.log(
        chalk.cyan('  langwatch evaluator create "My Evaluator" --type langevals/llm_judge'),
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
  } catch (error) {
    spinner.fail();
    if (error instanceof EvaluatorsApiError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error fetching evaluators: ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      );
    }
    process.exit(1);
  }
};
