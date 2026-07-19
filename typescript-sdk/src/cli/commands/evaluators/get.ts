import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { EvaluatorsApiService } from "@/client-sdk/services/evaluators";
import type { EvaluatorResponse } from "@/client-sdk/services/evaluators";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

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

  if (evaluator.platformUrl) {
    console.log(`  ${chalk.bold("View:")}  ${chalk.underline(evaluator.platformUrl)}`);
  }

  console.log();
};

/**
 * Returns the evaluator rather than printing it: the output port renders it in
 * whatever format the caller asked for (utils/output.ts).
 */
export const getEvaluatorCommand = async (idOrSlug: string): Promise<CommandResult | void> => {
  checkApiKey();

  const service = new EvaluatorsApiService();
  const spinner = createSpinner(`Fetching evaluator "${idOrSlug}"...`).start();

  let evaluator: EvaluatorResponse;
  try {
    evaluator = await service.get(idOrSlug);
    spinner.succeed(`Found evaluator "${evaluator.name}"`);
  } catch (error) {
    // No explicit `format`: see traces/search.ts — the preAction hook covers
    // every spelling; the `-f` commander default must not override it.
    failSpinner({ spinner, error, action: "fetch evaluator" });
    process.exit(1);
  }

  return {
    data: evaluator,
    table: () => formatEvaluatorDetails(evaluator),
  };
};
