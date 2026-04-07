import chalk from "chalk";
import ora from "ora";
import {
  EvaluatorsApiService,
  EvaluatorsApiError,
} from "@/client-sdk/services/evaluators";
import { checkApiKey } from "../../utils/apiKey";

const stripAnsi = (str: string): string => {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\u001b\[[0-9;]*m/g, "");
};

const formatTable = (
  data: Array<Record<string, string>>,
  headers: string[],
): void => {
  if (data.length === 0) {
    console.log(chalk.gray("No evaluators found"));
    return;
  }

  const colWidths: Record<string, number> = {};
  headers.forEach((header) => {
    colWidths[header] = Math.max(
      header.length,
      ...data.map((row) => stripAnsi(row[header] ?? "").length),
    );
  });

  const headerRow = headers
    .map((header) => chalk.bold(header.padEnd(colWidths[header]!)))
    .join("  ");
  console.log(headerRow);

  const separator = headers
    .map((header) => "─".repeat(colWidths[header]!))
    .join("  ");
  console.log(chalk.gray(separator));

  data.forEach((row) => {
    const dataRow = headers
      .map((header) => {
        const value = row[header] ?? "";
        const strippedLength = stripAnsi(value).length;
        const paddingNeeded = colWidths[header]! - strippedLength;
        const paddedValue = value + " ".repeat(Math.max(0, paddingNeeded));

        if (header === "Name") {
          return chalk.cyan(paddedValue);
        } else if (header === "Slug") {
          return chalk.green(paddedValue);
        } else if (header === "Type") {
          return chalk.yellow(paddedValue);
        } else {
          return chalk.gray(paddedValue);
        }
      })
      .join("  ");
    console.log(dataRow);
  });
};

const formatRelativeTime = (dateString: string): string => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (years > 0) return `${years}y ago`;
  if (months > 0) return `${months}mo ago`;
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return `${seconds}s ago`;
};

export const listEvaluatorsCommand = async (): Promise<void> => {
  try {
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

      formatTable(tableData, ["Name", "Slug", "Type", "Updated"]);

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
