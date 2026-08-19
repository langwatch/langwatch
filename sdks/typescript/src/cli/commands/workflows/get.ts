import chalk from "chalk";
import { WorkflowsApiService } from "@/client-sdk/services/workflows/workflows-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";

export const getWorkflowCommand = async (
  id: string,
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = new WorkflowsApiService();
  const spinner = createSpinner(`Fetching workflow "${id}"...`).start();

  try {
    const workflow = await service.get(id);
    spinner.succeed(`Found workflow "${workflow.name}"`);

    return {
      data: workflow,
      table: () => {
        console.log();
        console.log(chalk.bold.cyan(workflow.name));
        console.log(chalk.gray("─".repeat(40)));
        console.log(`  ${chalk.gray("ID:")}          ${workflow.id}`);
        if (workflow.description) {
          console.log(
            `  ${chalk.gray("Description:")} ${workflow.description}`,
          );
        }
        console.log(
          `  ${chalk.gray("Evaluator:")}   ${workflow.isEvaluator ? chalk.green("yes") : "no"}`,
        );
        console.log(
          `  ${chalk.gray("Component:")}   ${workflow.isComponent ? chalk.green("yes") : "no"}`,
        );
        console.log(
          `  ${chalk.gray("Created:")}     ${new Date(workflow.createdAt).toLocaleString()}`,
        );
        console.log(
          `  ${chalk.gray("Updated:")}     ${new Date(workflow.updatedAt).toLocaleString()}`,
        );
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch workflow" });
    process.exit(1);
  }
};
