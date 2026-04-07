import chalk from "chalk";
import ora from "ora";
import {
  EvaluatorsApiService,
  EvaluatorsApiError,
} from "@/client-sdk/services/evaluators";
import type { EvaluatorResponse } from "@/client-sdk/services/evaluators";
import { checkApiKey } from "../../utils/apiKey";

const formatEvaluatorDetails = (evaluator: EvaluatorResponse): void => {
  const config = evaluator.config as
    | { evaluatorType?: string; settings?: Record<string, unknown> }
    | null
    | undefined;
  const evaluatorType = config?.evaluatorType ?? evaluator.type ?? "—";

  console.log();
  console.log(chalk.bold.cyan(evaluator.name));
  console.log(chalk.gray("─".repeat(40)));

  console.log(`  ${chalk.gray("ID:")}          ${evaluator.id}`);
  console.log(`  ${chalk.gray("Slug:")}        ${evaluator.slug ?? chalk.gray("—")}`);
  console.log(`  ${chalk.gray("Type:")}        ${chalk.yellow(evaluatorType)}`);
  console.log(`  ${chalk.gray("Created:")}     ${new Date(evaluator.createdAt).toLocaleString()}`);
  console.log(`  ${chalk.gray("Updated:")}     ${new Date(evaluator.updatedAt).toLocaleString()}`);

  if (evaluator.workflowId) {
    console.log(`  ${chalk.gray("Workflow ID:")} ${evaluator.workflowId}`);
  }

  if (evaluator.fields.length > 0) {
    console.log();
    console.log(chalk.bold("  Input Fields:"));
    evaluator.fields.forEach((field) => {
      const optional = field.optional ? chalk.gray(" (optional)") : "";
      console.log(`    ${chalk.green("•")} ${field.identifier}: ${chalk.gray(field.type)}${optional}`);
    });
  }

  if (evaluator.outputFields.length > 0) {
    console.log();
    console.log(chalk.bold("  Output Fields:"));
    evaluator.outputFields.forEach((field) => {
      const optional = field.optional ? chalk.gray(" (optional)") : "";
      console.log(`    ${chalk.green("•")} ${field.identifier}: ${chalk.gray(field.type)}${optional}`);
    });
  }

  if (config?.settings && Object.keys(config.settings).length > 0) {
    console.log();
    console.log(chalk.bold("  Settings:"));
    for (const [key, value] of Object.entries(config.settings)) {
      const displayValue =
        typeof value === "object"
          ? JSON.stringify(value)
          : `${value as string | number | boolean}`;
      console.log(`    ${chalk.gray(key + ":")} ${displayValue}`);
    }
  }

  console.log();
};

export const getEvaluatorCommand = async (idOrSlug: string): Promise<void> => {
  try {
    checkApiKey();

    const service = new EvaluatorsApiService();
    const spinner = ora(`Fetching evaluator "${idOrSlug}"...`).start();

    try {
      const evaluator = await service.get(idOrSlug);
      spinner.succeed(`Found evaluator "${evaluator.name}"`);
      formatEvaluatorDetails(evaluator);
    } catch (error) {
      spinner.fail();
      if (error instanceof EvaluatorsApiError) {
        console.error(chalk.red(`Error: ${error.message}`));
      } else {
        console.error(
          chalk.red(
            `Error fetching evaluator: ${error instanceof Error ? error.message : "Unknown error"}`,
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
